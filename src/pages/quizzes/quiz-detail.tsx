import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft, Award, RefreshCw, Timer } from 'lucide-react';

import { useQuiz, useAttempts, useStartAttempt } from '@/hooks/useQuiz';
import * as quizzesApi from '@/api/quizzes';
import { useAuthUser } from '@/stores/auth';
import { isStaff } from '@/lib/utils';
import { CenteredLoader } from '@/components/auth/route-guards';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { QuizCountdown } from '@/components/quiz-countdown';
import { cn } from '@/lib/utils';
import type { QuizAttempt } from '@/types/models';

export function QuizDetailPage() {
  const { id } = useParams<'id'>();
  const itemId = id ?? '';
  const user = useAuthUser();
  const staff = user ? isStaff(user.role) : false;

  const { data: quiz, isLoading: quizLoading } = useQuiz(itemId);
  const { data: attempts = [] } = useAttempts(itemId);

  const [attempt, setAttempt] = useState<QuizAttempt | null>(null);
  const [answerMap, setAnswerMap] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QuizAttempt | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [expired, setExpired] = useState(false);

  const startAttempt = useStartAttempt(itemId);

  if (quizLoading) return <CenteredLoader label="Loading quiz…" />;
  if (!quiz) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <h1 className="text-xl font-semibold">Quiz not found</h1>
        <p className="mt-1 text-sm text-muted-foreground">It may be unpublished or you don't have access.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/courses">Back to courses</Link>
        </Button>
      </div>
    );
  }

  // The create/update response types keep `questions` optional — the GET path
  // always includes them, but guard so the editor previews stay safe too.
  const questions = quiz.questions ?? [];

  async function handleStart() {
    setResult(null);
    setAnswerMap({});
    setExpired(false);
    try {
      const a = await startAttempt.mutateAsync();
      setAttempt(a);
    } catch { /* toast covers */ }
  }

  async function handleSubmit() {
    if (!attempt) return;
    const answers = Object.entries(answerMap).map(([questionId, selectedOptionId]) => ({ questionId, selectedOptionId }));
    if (answers.length === 0) return;
    setSubmitting(true);
    try {
      const updated = await quizzesApi.submitAttempt(attempt.id, { answers });
      setResult(updated);
      setAttempt(null);
    } catch {
      setSubmitting(false);
    }
  }

  // Backend statuses are IN_PROGRESS / SUBMITTED / EXPIRED — 'GRADED' never
  // exists, so "past attempts" are the submitted/expired finished ones.
  const pastAttempts = attempts.filter((a) => a.status !== 'IN_PROGRESS');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/courses"><ArrowLeft className="mr-1 h-4 w-4" aria-hidden /> Back</Link>
        </Button>
      </div>

      <PageHeader title={quiz.instructions ? 'Quiz' : 'Quiz'} description={quiz.instructions ?? undefined}>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{questions.length} questions</Badge>
          {quiz.timeLimitMinutes ? (
            <Badge variant="outline"><Timer className="mr-1 h-3.5 w-3.5" aria-hidden /> {quiz.timeLimitMinutes} min</Badge>
          ) : null}
          {attempt?.expiresAt ? (
            <QuizCountdown expiresAt={attempt.expiresAt} onExpire={() => setExpired(true)} />
          ) : null}
          <Badge variant="secondary">Pass: {quiz.passingScore}</Badge>
        </div>
      </PageHeader>

      {/* Staff sees the quiz config + question list with isCorrect; students see attempts + play */}
      {staff ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Questions (staff preview)</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {questions.map((q, qi) => (
              <div key={q.id} className="rounded-lg border p-4">
                <p className="text-sm font-medium">
                  <span className="text-muted-foreground">Q{qi + 1}.</span> {q.prompt}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{q.points} pts</span>
                </p>
                <ul className="mt-2 space-y-1.5">
                  {q.options.map((opt) => (
                    <li
                      key={opt.id}
                      className={cn(
                        'flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm',
                        opt.isCorrect ? 'border-success/50 bg-success/5' : '',
                      )}
                    >
                      <span className={cn('h-4 w-4 rounded-full border flex items-center justify-center', opt.isCorrect ? 'border-success bg-success text-white' : 'border-muted-foreground')}>
                        {opt.isCorrect ? <span className="text-[10px]">✓</span> : null}
                      </span>
                      {opt.text}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Result display */}
      {result ? (
        <Card className="mx-auto max-w-xl">
          <CardContent className="flex flex-col items-center py-10 text-center">
            <div className={cn('flex h-12 w-12 items-center justify-center rounded-full', result.passed === true ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning')}>
              {result.passed === true ? <Award className="h-6 w-6" aria-hidden /> : <RefreshCw className="h-6 w-6" aria-hidden />}
            </div>
            <h2 className="mt-4 text-xl font-semibold">{result.passed === true ? 'Quiz passed!' : 'Quiz not passed'}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              You scored <span className="font-semibold text-foreground">{result.pointsEarned ?? 0}</span> / {result.pointsPossible ?? 0}
            </p>
            <div className="mt-5 flex gap-2">
              {quiz.maxAttempts > pastAttempts.length ? (
                <Button onClick={handleStart} disabled={startAttempt.isPending}>
                  {startAttempt.isPending ? 'Starting…' : 'Try again'}
                </Button>
              ) : null}
              <Button asChild variant="outline">
                <Link to="/courses">Back to courses</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Active attempt */}
      {attempt ? (
        <div className="space-y-4">
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
      ) : null}

      {/* Start button (student, not actively in attempt) */}
      {!attempt && !result && !staff ? (
        <Card className="mx-auto max-w-md">
          <CardContent className="flex flex-col items-center py-8 text-center">
            <p className="text-sm text-muted-foreground">Ready?</p>
            <Button className="mt-3" onClick={handleStart} disabled={startAttempt.isPending}>
              {startAttempt.isPending ? 'Starting…' : 'Start quiz'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Past attempts */}
      {!staff && pastAttempts.length > 0 && !attempt ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Past attempts</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pastAttempts.map((a) => (
                <div key={a.id} className="flex items-center gap-3 rounded-lg border px-4 py-2.5 text-sm">
                  <span className="text-muted-foreground">Attempt #{a.attemptNumber}</span>
                  <span className="flex-1 text-muted-foreground">{format(new Date(a.startedAt), 'MMM d, h:mm a')}</span>
                  <span className="font-medium">{a.pointsEarned ?? '—'} / {a.pointsPossible ?? '?'}</span>
                  <Badge variant={a.passed === true ? 'success' : 'warning'}>
                    {a.passed === true ? 'Passed' : 'Not passed'}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}