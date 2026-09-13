import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  Award,
  CheckCircle2,
  FileText,
  PlayCircle,
  Send,
  Timer,
  X,
} from 'lucide-react';

import { useAuthUser } from '@/stores/auth';
import { useCourse } from '@/hooks/useCourses';
import { useQuiz, useStartAttempt } from '@/hooks/useQuiz';
import * as quizzesApi from '@/api/quizzes';
import * as uploadsApi from '@/api/upload';
import { useAssignment, useSubmitAssignment } from '@/hooks/useAssignment';
import { useVideoUrl, useRecordHeartbeat } from '@/hooks/useVideo';
import { isStaff } from '@/lib/utils';
import { CenteredLoader } from '@/components/auth/route-guards';
import { PageHeader } from '@/components/page-header';
import { FilePicker } from '@/components/file-picker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { QuizCountdown } from '@/components/quiz-countdown';
import { cn } from '@/lib/utils';
import type { LessonItemView, QuizAttempt } from '@/types/models';

type ItemKind = LessonItemView['kind'];

function ItemIcon({ kind }: { kind: ItemKind }) {
  if (kind === 'VIDEO') return <PlayCircle className="h-4 w-4 shrink-0" aria-hidden />;
  if (kind === 'QUIZ') return <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-warning/20 text-[10px] font-bold text-warning">?</div>;
  return <FileText className="h-4 w-4 shrink-0" aria-hidden />;
}

/** Look up the currently-selected lesson item across the whole tree. */
function findItem(items: LessonItemView[], itemId: string | null): LessonItemView | null {
  if (!itemId) return null;
  return items.find((i) => i.id === itemId) ?? null;
}

// ── Video player ────────────────────────────────────────────────────────────

function VideoPlayer({ itemId }: { itemId: string }) {
  const { data: video, isLoading: urlLoading, error } = useVideoUrl(itemId);
  const heartbeat = useRecordHeartbeat(itemId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastKnown = useRef<number>(0);
  const [playedMs, setPlayedMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const stableInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const src = video?.url;

  // Heartbeat every 15s while playing.
  useEffect(() => {
    if (!playing) {
      if (stableInterval.current) {
        clearInterval(stableInterval.current);
        stableInterval.current = null;
      }
      return;
    }
    stableInterval.current = setInterval(() => {
      const el = videoRef.current;
      if (!el || el.paused) return;
      const position = el.currentTime;
      const playedMsDelta = playedMs;
      setPlayedMs(0);
      heartbeat.mutateAsync({
        type: 'HEARTBEAT',
        positionSeconds: position,
        watchedSecondsDelta: playedMsDelta,
        intervalSeconds: 15,
        playbackRate: el.playbackRate,
        device: detectDevice(),
      });
    }, 15_000);
    return () => {
      if (stableInterval.current) {
        clearInterval(stableInterval.current);
        stableInterval.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  function detectDevice(): string {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    if (/Windows/i.test(ua)) return 'windows';
    if (/Mac/i.test(ua)) return 'macos';
    return 'desktop';
  }

  // Report pause/end immediately rather than waiting for the next heartbeat.
  function reportState(type: 'PAUSE' | 'ENDED') {
    const el = videoRef.current;
    if (!el) return;
    heartbeat.mutateAsync({
      type,
      positionSeconds: el.currentTime,
      watchedSecondsDelta: playedMs,
      intervalSeconds: undefined,
      playbackRate: el.playbackRate,
      device: detectDevice(),
    });
    setPlayedMs(0);
  }

  if (urlLoading) return <Skeleton className="h-[22rem] w-full rounded-lg" />;
  if (error || !src) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Video unavailable right now.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-black">
      <video
        ref={videoRef}
        src={src}
        controls
        className="aspect-video w-full"
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          reportState('PAUSE');
        }}
        onEnded={() => {
          setPlaying(false);
          reportState('ENDED');
        }}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          if (t > lastKnown.current) {
            setPlayedMs((p) => p + 1000);
            lastKnown.current = t;
          }
        }}
        onSeeked={(e) => {
          lastKnown.current = e.currentTarget.currentTime;
        }}
      />
    </div>
  );
}

// ── Quiz player ─────────────────────────────────────────────────────────────

function QuizPlayer({ itemId, onComplete }: { itemId: string; onComplete?: (passed: boolean) => void }) {
  const { data: quiz, isLoading } = useQuiz(itemId);
  const startAttempt = useStartAttempt(itemId);

  const [attempt, setAttempt] = useState<QuizAttempt | null>(null);
  const [answerMap, setAnswerMap] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QuizAttempt | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [expired, setExpired] = useState(false);

  async function handleStart() {
    try {
      setResult(null);
      setAnswerMap({});
      setExpired(false);
      const a = await startAttempt.mutateAsync();
      setAttempt(a);
    } catch { /* toast covers */ }
  }

  async function handleSubmit() {
    if (!attempt) return;
    const answers = Object.entries(answerMap).map(([questionId, selectedOptionId]) => ({ questionId, selectedOptionId }));
    if (answers.length === 0) {
      toast.error('Answer at least one question before submitting.');
      return;
    }
    setSubmitting(true);
    try {
      const updated = await quizzesApi.submitAttempt(attempt.id, { answers });
      setResult(updated);
      setAttempt(null);
      onComplete?.(updated.passed === true);
    } catch {
      setSubmitting(false);
    }
  }

  if (isLoading) return <Skeleton className="h-40 w-full rounded-lg" />;
  if (!quiz) return null;

  const questions = quiz.questions ?? [];

  // Finished and graded
  if (result) {
    const passed = result.passed === true;
    return (
      <Card className="mx-auto max-w-xl">
        <CardContent className="flex flex-col items-center py-10 text-center">
          <div className={cn('flex h-12 w-12 items-center justify-center rounded-full', passed ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning')}>
            {passed ? <Award className="h-6 w-6" aria-hidden /> : <X className="h-6 w-6" aria-hidden />}
          </div>
          <h2 className="mt-4 text-xl font-semibold">{passed ? 'Quiz passed' : 'Quiz not passed'}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            You scored{' '}
            <span className="font-semibold text-foreground">{result.pointsEarned ?? 0}</span> /{' '}
            {result.pointsPossible ?? 0}
          </p>
          {quiz.passingScore > 0 ? (
            <p className="text-xs text-muted-foreground">Passing score: {quiz.passingScore}</p>
          ) : null}
          <div className="mt-5 flex gap-2">
            <Button variant="outline" size="sm" onClick={handleStart}>Try again</Button>
            <Button size="sm" onClick={() => onComplete?.(passed)}>Continue</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Not started yet
  if (!attempt) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardContent className="py-8 text-center">
          <h3 className="text-lg font-semibold">Ready to start the quiz?</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {quiz.instructions ?? 'Answer the questions below and submit to check your score.'}
          </p>
          {quiz.timeLimitMinutes ? (
            <div className="mt-2 flex items-center justify-center gap-1 text-sm text-muted-foreground">
              <Timer className="h-4 w-4" aria-hidden /> {quiz.timeLimitMinutes} min · {questions.length} questions
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">{questions.length} questions</p>
          )}
          <Button className="mt-5" onClick={handleStart} disabled={startAttempt.isPending}>
            {startAttempt.isPending ? 'Starting…' : 'Start quiz'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {attempt.expiresAt ? (
        <div className="flex items-center justify-between rounded-md border px-3 py-2">
          <span className="text-sm text-muted-foreground">Time remaining</span>
          <QuizCountdown expiresAt={attempt.expiresAt} onExpire={() => setExpired(true)} />
        </div>
      ) : null}
      {questions.map((q, qi) => (
        <Card key={q.id}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Question {qi + 1}
              <span className="ml-2 text-xs font-normal text-muted-foreground">{q.points} pts</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-medium">{q.prompt}</p>
            <RadioGroup
              className="mt-3"
              value={answerMap[q.id] ?? ''}
              onValueChange={(v) => setAnswerMap((m) => ({ ...m, [q.id]: v }))}
            >
              {q.options.map((opt) => (
                <div key={opt.id} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                  <RadioGroupItem value={opt.id} id={`${q.id}-${opt.id}`} />
                  <Label htmlFor={`${q.id}-${opt.id}`} className="font-normal">{opt.text}</Label>
                </div>
              ))}
            </RadioGroup>
          </CardContent>
        </Card>
      ))}

      <div className="flex items-center justify-between gap-3">
        {expired ? (
          <p className="text-sm text-destructive">
            Time's up — this attempt was expired by the server and can no longer be submitted.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{Object.keys(answerMap).length} / {questions.length} answered</p>
        )}
        <Button onClick={handleSubmit} disabled={submitting || expired || Object.keys(answerMap).length === 0}>
          {submitting ? 'Submitting…' : 'Submit quiz'}
        </Button>
      </div>
    </div>
  );
}

// ── Assignment panel ────────────────────────────────────────────────────────

function AssignmentPanel({ itemId }: { itemId: string }) {
  const { data: assignment, isLoading } = useAssignment(itemId);
  const submit = useSubmitAssignment(itemId);
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  if (isLoading) return <Skeleton className="h-40 w-full rounded-lg" />;
  if (!assignment) return null;

  const reqBody = assignment.instructions;

  async function handleSubmit() {
    if (!body.trim() && !file) {
      toast.error('Write something or attach a file before submitting.');
      return;
    }
    setUploading(true);
    try {
      // When a file is attached, upload it to storage first and pass the key
      // through to the submission — the backend never proxies the bytes.
      let fileKey: string | undefined;
      if (file) {
        fileKey = await uploadsApi.uploadSubmissionFile(itemId, file, setUploadProgress);
      }
      await submit.mutateAsync({ bodyText: body.trim() || undefined, fileKey });
      toast.success('Assignment submitted!');
      setBody('');
      setFile(null);
      setUploadProgress(0);
    } catch {
      /* toast covers */
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assignment details</CardTitle>
          <CardDescription>Due {assignment.dueAt ? new Date(assignment.dueAt).toLocaleString() : 'not set'} · {assignment.maxPoints} pts</CardDescription>
        </CardHeader>
        <CardContent>
          {reqBody ? (
            <p className="whitespace-pre-line text-sm text-muted-foreground">{reqBody}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No further instructions — write your answer and submit.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Your answer</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {assignment.allowsFile ? (
            <FilePicker
              accept=".pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg"
              name={file ? file.name : null}
              onFile={setFile}
              onClear={() => setFile(null)}
              uploading={uploading}
              progress={uploadProgress}
              label="Attach a file"
            />
          ) : null}
          <Textarea
            rows={8}
            placeholder="Write your answer here…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex justify-end">
            <Button
              onClick={handleSubmit}
              disabled={submit.isPending || uploading || (!body.trim() && !file)}
            >
              <Send className="mr-1" aria-hidden /> Submit assignment
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export function CourseLearnPage() {
  const { id } = useParams<'id'>();
  const courseId = id ?? '';
  const user = useAuthUser();
  const staff = user ? isStaff(user.role) : false;

  const { data: course, isLoading, error } = useCourse(courseId);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  // Flatten tree into a single ordered list for the sidebar and
  // "previous / next" navigation.
  const { flatList } = useMemo(() => {
    const list: LessonItemView[] = [];
    if (course) {
      for (const m of course.modules) {
        for (const ch of m.chapters) {
          for (const lesson of ch.lessons) {
            for (const item of lesson.items) {
              list.push(item);
            }
          }
        }
      }
    }
    return { flatList: list };
  }, [course]);

  // Auto-select first item when loaded.
  useEffect(() => {
    if (flatList.length > 0 && !selectedItemId) {
      setSelectedItemId(flatList[0].id);
    }
  }, [flatList, selectedItemId]);

  if (isLoading) return <CenteredLoader label="Loading course…" />;
  if (error || !course) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <h1 className="text-xl font-semibold">Course unavailable</h1>
        <p className="mt-1 text-sm text-muted-foreground">It may be unpublished, removed, or not assigned to you.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/courses">Back to courses</Link>
        </Button>
      </div>
    );
  }

  const current = findItem(flatList, selectedItemId);
  const currentIndex = current ? flatList.indexOf(current) : -1;
  const prevItem = currentIndex > 0 ? flatList[currentIndex - 1] : null;
  const nextItem = currentIndex >= 0 && currentIndex < flatList.length - 1 ? flatList[currentIndex + 1] : null;

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col lg:flex-row lg:gap-6">
      {/* Sidebar / table of contents */}
      <aside className="w-full lg:w-80 lg:shrink-0">
        <div className="lg:sticky lg:top-20">
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
            <Link to={`/courses/${course.id}`}><ArrowLeft className="mr-1 h-4 w-4" aria-hidden /> Course page</Link>
          </Button>
          <p className="mb-2 line-clamp-1 px-1 text-sm font-semibold">{course.title}</p>
          <ScrollArea className="h-[calc(100vh-14rem)] rounded-md border">
            <nav className="p-2">
              {course.modules.map((module) => (
                <div key={module.id} className="mb-3">
                  <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {module.title}
                  </p>
                  {module.chapters.map((chapter) => (
                    <div key={chapter.id} className="mb-1">
                      <p className="px-2 text-xs font-medium text-muted-foreground">{chapter.title}</p>
                      <div className="space-y-0.5">
                        {chapter.lessons.map((lesson) => (
                          <div key={lesson.id} className="space-y-0.5">
                            <p className="px-2 py-0.5 text-xs text-muted-foreground">{lesson.title}</p>
                            {lesson.items.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => setSelectedItemId(item.id)}
                                className={cn(
                                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                                  item.id === selectedItemId
                                    ? 'bg-accent font-medium text-foreground'
                                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                                  !item.isPublished && 'opacity-50',
                                )}
                              >
                                <ItemIcon kind={item.kind} />
                                <span className="line-clamp-1">{item.title}</span>
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </nav>
          </ScrollArea>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 space-y-4 lg:mt-0">
        {current ? (
          <>
            <PageHeader title={current.title} description={staff ? 'You are viewing this as staff.' : undefined}>
              <Badge variant={current.isPublished ? 'secondary' : 'warning'}>{current.isPublished ? 'Published' : 'Unpublished'}</Badge>
            </PageHeader>

            {current.kind === 'VIDEO' && <VideoPlayer itemId={current.id} />}
            {current.kind === 'QUIZ' && (
              <QuizPlayer
                itemId={current.id}
                onComplete={(passed) => {
                  if (passed) toast.success('Quiz passed!');
                }}
              />
            )}
            {current.kind === 'ASSIGNMENT' && <AssignmentPanel itemId={current.id} />}

            {/* Prev / next */}
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                {prevItem ? (
                  <Button variant="outline" size="sm" onClick={() => setSelectedItemId(prevItem.id)}>
                    <ArrowLeft className="mr-1 h-4 w-4" aria-hidden /> Previous
                  </Button>
                ) : null}
              </div>
              {nextItem ? (
                <Button size="sm" onClick={() => setSelectedItemId(nextItem.id)}>
                  Next <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
                </Button>
              ) : (
                <Button asChild size="sm" variant="outline">
                  <Link to="/courses"><CheckCircle2 className="mr-1 h-4 w-4" aria-hidden /> Finish</Link>
                </Button>
              )}
            </div>
          </>
        ) : (
          <Card>
            <CardContent className="py-20 text-center text-sm text-muted-foreground">
              No published activities in this course yet.
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}