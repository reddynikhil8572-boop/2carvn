import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Eye,
  EyeOff,
  GraduationCap,
  Layers,
  Plus,
  Settings2,
} from 'lucide-react';

import * as coursesApi from '@/api/courses';
import * as uploadsApi from '@/api/upload';
import { courseKeys, useAssignCourseToClass, useCourse, useCreateModule, useUpdateCourse } from '@/hooks/useCourses';
import { useClasses } from '@/hooks/useClasses';
import { uploadKeys, useCoverUrl } from '@/hooks/useUpload';
import { PageHeader } from '@/components/page-header';
import { CenteredLoader } from '@/components/auth/route-guards';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { FilePicker } from '@/components/file-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import type { CourseStatus, LessonItemKind } from '@/types/api';
import type { LessonItemView } from '@/types/models';

// ── Schemas ────────────────────────────────────────────────────────────────

const titleSchema = z.object({ title: z.string().trim().min(1, 'Title is required').max(200) });
const lessonSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  summary: z.string().trim().max(2000).optional(),
});

type TitleValues = z.infer<typeof titleSchema>;
type LessonValues = z.infer<typeof lessonSchema>;

// ── Tiny helpers ───────────────────────────────────────────────────────────

const kindLabel: Record<LessonItemKind, string> = { VIDEO: 'Video', QUIZ: 'Quiz', ASSIGNMENT: 'Assignment' };

function ItemRow({
  item,
  index,
  total,
  onMove,
  onTogglePublish,
}: {
  item: LessonItemView;
  index: number;
  total: number;
  onMove: (dir: -1 | 1) => void;
  onTogglePublish: () => void;
}) {
  const icon = item.isPublished ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />;
  return (
    <li className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5${item.isPublished ? '' : ' opacity-70'}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {kindLabel[item.kind]}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={onTogglePublish}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={item.isPublished ? 'Unpublish' : 'Publish'}
        >
          {icon}
        </button>
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={index === 0}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
          aria-label="Move up"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={index === total - 1}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
          aria-label="Move down"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export function CourseEditPage() {
  const { id } = useParams<'id'>();
  const courseId = id ?? '';
  const queryClient = useQueryClient();

  const { data: course, isLoading } = useCourse(courseId);
  const updateCourse = useUpdateCourse(courseId);
  const createModule = useCreateModule(courseId);
  const assignToClass = useAssignCourseToClass(courseId);
  const { data: classes = [] } = useClasses();
  const { data: cover, isLoading: coverLoading } = useCoverUrl(courseId);

  const [activeStatus, setActiveStatus] = useState<CourseStatus | null>(null);

  // Cover upload state
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverProgress, setCoverProgress] = useState(0);

  // Structural-node dialogs
  const [addModuleOpen, setAddModuleOpen] = useState(false);
  const [addChapterFor, setAddChapterFor] = useState<string | null>(null);
  const [addLessonFor, setAddLessonFor] = useState<string | null>(null);
  const [addItemFor, setAddItemFor] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignClassId, setAssignClassId] = useState('');

  // Item dialog state
  const [itemKind, setItemKind] = useState<LessonItemKind>('VIDEO');
  const [itemTitle, setItemTitle] = useState('');
  const [itemUrl, setItemUrl] = useState('');
  const [itemInstructions, setItemInstructions] = useState('');
  const [itemFile, setItemFile] = useState<File | null>(null);
  const [itemAllowsFile, setItemAllowsFile] = useState(false);
  const [itemUploading, setItemUploading] = useState(false);
  const [itemUploadProgress, setItemUploadProgress] = useState(0);

  const moduleForm = useForm<TitleValues>({ resolver: zodResolver(titleSchema), defaultValues: { title: '' } });
  const chapterForm = useForm<TitleValues>({ resolver: zodResolver(titleSchema), defaultValues: { title: '' } });
  const lessonForm = useForm<LessonValues>({ resolver: zodResolver(lessonSchema), defaultValues: { title: '', summary: '' } });

  if (isLoading) return <CenteredLoader label="Loading editor…" />;
  if (!course) return null;

  const displayedStatus = activeStatus ?? course.status;

  /** Refetch the course tree after any structural change (nested node IDs are only knowable at click time, so we invalidate manually). */
  async function refreshTree() {
    await queryClient.invalidateQueries({ queryKey: courseKeys.detail(courseId) });
  }

  // ── Status ─────────────────────────────────────────────────────────────

  async function saveStatus(next: CourseStatus) {
    setActiveStatus(next);
    try {
      await updateCourse.mutateAsync({ status: next });
      toast.success(next === 'PUBLISHED' ? 'Course published' : `Status set to ${next}`);
    } catch {
      setActiveStatus(null);
    }
  }

  // ── Module creation (top-level hook, safe) ──────────────────────────────

  async function onCreateModule(values: TitleValues) {
    try {
      await createModule.mutateAsync({ title: values.title });
      toast.success('Module added');
      setAddModuleOpen(false);
      moduleForm.reset();
    } catch { /* toast covers */ }
  }

  // ── Chapter / lesson / item / reorder / publish ─────────────────────────
  // These take IDs only known at click time, so we call the raw API and
  // invalidate the tree manually — never a hook inside a handler.

  async function onCreateChapter(moduleId: string, values: TitleValues) {
    try {
      await coursesApi.createChapter(moduleId, { title: values.title });
      await refreshTree();
      toast.success('Chapter added');
      setAddChapterFor(null);
      chapterForm.reset();
    } catch { /* toast covers */ }
  }

  async function onCreateLesson(chapterId: string, values: LessonValues) {
    try {
      await coursesApi.createLesson(chapterId, values);
      await refreshTree();
      toast.success('Lesson added');
      setAddLessonFor(null);
      lessonForm.reset();
    } catch { /* toast covers */ }
  }

  async function onCreateItem(lessonId: string) {
    if (!itemTitle.trim()) return;
    const title = itemTitle.trim();
    const kind = itemKind;
    try {
      if (kind === 'VIDEO' && itemFile) {
        // Video files are item-scoped on the backend: create the item first,
        // then presign the upload against its id, stream the bytes, confirm
        // (stores key + duration), and let the player serve the signed URL.
        setItemUploading(true);
        setItemUploadProgress(0);
        const created = await coursesApi.createLessonItem(lessonId, { kind: 'VIDEO', title });
        await uploadsApi.uploadVideo(created.id, itemFile, setItemUploadProgress);
        toast.success('Activity added');
      } else {
        const base = { title };
        const payload =
          kind === 'VIDEO'
            ? { ...base, kind: 'VIDEO' as const, externalUrl: itemUrl.trim() || undefined }
            : kind === 'QUIZ'
              ? { ...base, kind: 'QUIZ' as const, instructions: itemInstructions.trim() || undefined }
              : {
                  ...base,
                  kind: 'ASSIGNMENT' as const,
                  instructions: itemInstructions.trim() || undefined,
                  allowsFile: itemAllowsFile,
                };
        await coursesApi.createLessonItem(lessonId, payload);
        toast.success('Activity added');
      }
      await refreshTree();
      setAddItemFor(null);
      setItemTitle('');
      setItemUrl('');
      setItemInstructions('');
      setItemFile(null);
      setItemAllowsFile(false);
      setItemUploadProgress(0);
    } catch { /* toast covers */ } finally {
      setItemUploading(false);
    }
  }

  async function onCoverFile(file: File) {
    setCoverUploading(true);
    setCoverProgress(0);
    try {
      await uploadsApi.uploadCover(courseId, file, setCoverProgress);
      queryClient.invalidateQueries({ queryKey: uploadKeys.cover(courseId) });
      toast.success('Cover updated');
    } catch { /* toast covers */ } finally {
      setCoverUploading(false);
    }
  }

  async function moveItem(lessonId: string, items: LessonItemView[], item: LessonItemView, dir: -1 | 1) {
    const index = items.findIndex((i) => i.id === item.id);
    const swap = index + dir;
    if (index < 0 || swap < 0 || swap >= items.length) return;
    const next = [...items];
    [next[index], next[swap]] = [next[swap], next[index]];
    try {
      await coursesApi.reorderLessonItems(lessonId, next.map((i) => i.id));
      await refreshTree();
    } catch { /* toast covers */ }
  }

  async function togglePublish(item: LessonItemView) {
    try {
      await coursesApi.updateLessonItem(item.id, { isPublished: !item.isPublished });
      await refreshTree();
    } catch { /* toast covers */ }
  }

  // ── Counts ──────────────────────────────────────────────────────────────

  const chapterCount = course.modules.reduce((s, m) => s + m.chapters.length, 0);
  const lessonCount = course.modules.reduce(
    (s, m) => s + m.chapters.reduce((cs, ch) => cs + ch.lessons.length, 0),
    0,
  );

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to={`/courses/${course.id}`}><ArrowLeft className="mr-1 h-4 w-4" aria-hidden /> Back</Link>
        </Button>
      </div>

      <PageHeader title={course.title} description="Build your course structure — modules, chapters, lessons and activities.">
        <Button variant="outline" size="sm" onClick={() => setAssignOpen(true)}>
          <GraduationCap className="mr-1" aria-hidden /> Assign to class
        </Button>
        {displayedStatus !== 'PUBLISHED' ? (
          <Button size="sm" onClick={() => saveStatus('PUBLISHED')} disabled={updateCourse.isPending}>Publish</Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => saveStatus('DRAFT')} disabled={updateCourse.isPending}>Unpublish</Button>
        )}
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Course details form */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings2 className="h-4 w-4 text-muted-foreground" aria-hidden /> Course details
            </CardTitle>
            <CardDescription>Changes save when you hit Save.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                const title = String(data.get('title') ?? '').trim();
                if (!title) return;
                updateCourse
                  .mutateAsync({
                    title,
                    subject: String(data.get('subject') ?? '').trim() || undefined,
                    description: String(data.get('description') ?? '').trim() || undefined,
                  })
                  .then(() => toast.success('Course updated'))
                  .catch(() => {});
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="course-title">Title</Label>
                <Input id="course-title" name="title" defaultValue={course.title} required maxLength={200} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="course-subject">Subject</Label>
                <Input id="course-subject" name="subject" defaultValue={course.subject ?? ''} maxLength={100} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="course-description">Description</Label>
                <Textarea id="course-description" name="description" rows={4} defaultValue={course.description ?? ''} maxLength={5000} />
              </div>
              <div className="space-y-2">
                <Label>Cover image</Label>
                <div className="flex items-center gap-3">
                  {coverLoading ? (
                    <div className="h-20 w-32 shrink-0 rounded-md border border-border bg-muted" />
                  ) : cover?.url ? (
                    <img
                      src={cover.url}
                      alt="Course cover"
                      className="h-20 w-32 shrink-0 rounded-md border border-border object-cover"
                    />
                  ) : (
                    <div className="flex h-20 w-32 shrink-0 items-center justify-center rounded-md border border-dashed px-2 text-center text-xs text-muted-foreground">
                      No cover
                    </div>
                  )}
                  <FilePicker
                    accept="image/*"
                    label={cover?.url ? 'Replace cover' : 'Upload cover'}
                    name={null}
                    onFile={onCoverFile}
                    onClear={() => {}}
                    uploading={coverUploading}
                    progress={coverProgress}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={updateCourse.isPending}>
                  {updateCourse.isPending ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Status + stats */}
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Status</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Badge variant={displayedStatus === 'PUBLISHED' ? 'success' : displayedStatus === 'ARCHIVED' ? 'warning' : 'secondary'}>
                {displayedStatus}
              </Badge>
              <Select value={displayedStatus} onValueChange={(v) => { if (v !== displayedStatus) saveStatus(v as CourseStatus); }}>
                <SelectTrigger className="w-full" aria-label="Course status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DRAFT">Draft</SelectItem>
                  <SelectItem value="PUBLISHED">Published</SelectItem>
                  <SelectItem value="ARCHIVED">Archived</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="grid grid-cols-3 gap-2 p-4 text-center">
              <div><p className="text-lg font-semibold">{course.modules.length}</p><p className="text-xs text-muted-foreground">Modules</p></div>
              <div><p className="text-lg font-semibold">{chapterCount}</p><p className="text-xs text-muted-foreground">Chapters</p></div>
              <div><p className="text-lg font-semibold">{lessonCount}</p><p className="text-xs text-muted-foreground">Lessons</p></div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Structure ────────────────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">Structure</h2>
          <Button size="sm" variant="outline" onClick={() => { moduleForm.reset(); setAddModuleOpen(true); }}>
            <Plus className="mr-1" aria-hidden /> Add module
          </Button>
        </div>

        {course.modules.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Layers className="h-8 w-8 text-muted-foreground" aria-hidden />
              <p className="mt-3 text-sm font-medium">Start with a module</p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                Modules are the top level of your course. Add the first one to begin.
              </p>
              <Button className="mt-4" size="sm" onClick={() => { moduleForm.reset(); setAddModuleOpen(true); }}>
                <Plus className="mr-1" aria-hidden /> Add module
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {course.modules.map((module) => (
              <Card key={module.id}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-primary" aria-hidden />
                    <p className="font-medium">{module.title}</p>
                    <span className="text-xs text-muted-foreground">{module.chapters.length} chapters</span>
                    <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => { chapterForm.reset(); setAddChapterFor(module.id); }}>
                      <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Chapter
                    </Button>
                  </div>
                  <Separator className="my-3" />
                  {module.chapters.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No chapters yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {module.chapters.map((chapter) => (
                        <div key={chapter.id} className="rounded-lg border p-3">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">{chapter.title}</p>
                            <span className="text-xs text-muted-foreground">{chapter.lessons.length} lessons</span>
                            <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => { lessonForm.reset(); setAddLessonFor(chapter.id); }}>
                              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Lesson
                            </Button>
                          </div>
                          <div className="mt-2 space-y-2">
                            {chapter.lessons.length === 0 ? (
                              <p className="text-sm text-muted-foreground">No lessons yet.</p>
                            ) : (
                              chapter.lessons.map((lesson) => (
                                <div key={lesson.id} className="rounded-md bg-accent/40 p-3">
                                  <div className="flex items-center gap-2">
                                    <p className="text-sm font-medium">{lesson.title}</p>
                                    <Button
                                      size="sm" variant="ghost" className="ml-auto h-7"
                                      onClick={() => {
                                        setItemKind('VIDEO');
                                        setItemTitle('');
                                        setItemUrl('');
                                        setItemInstructions('');
                                        setItemFile(null);
                                        setItemAllowsFile(false);
                                        setItemUploadProgress(0);
                                        setAddItemFor(lesson.id);
                                      }}
                                    >
                                      <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Activity
                                    </Button>
                                  </div>
                                  {lesson.summary ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{lesson.summary}</p> : null}
                                  {lesson.items.length > 0 ? (
                                    <ul className="mt-2 space-y-1.5">
                                      {lesson.items.map((item, ii) => (
                                        <ItemRow
                                          key={item.id}
                                          item={item}
                                          index={ii}
                                          total={lesson.items.length}
                                          onMove={(dir) => moveItem(lesson.id, lesson.items, item, dir)}
                                          onTogglePublish={() => togglePublish(item)}
                                        />
                                      ))}
                                    </ul>
                                  ) : (
                                    <p className="mt-2 text-xs text-muted-foreground">No activities yet — add a video, quiz or assignment.</p>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ── Add module dialog ────────────────────────────────────────────── */}
      <Dialog open={addModuleOpen} onOpenChange={setAddModuleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New module</DialogTitle>
            <DialogDescription>Modules are the top level of course structure.</DialogDescription>
          </DialogHeader>
          <Form {...moduleForm}>
            <form onSubmit={moduleForm.handleSubmit(onCreateModule)} className="space-y-4" noValidate>
              <FormField control={moduleForm.control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl><Input placeholder="e.g. Introduction" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAddModuleOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createModule.isPending}>{createModule.isPending ? 'Adding…' : 'Add module'}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Add chapter dialog ───────────────────────────────────────────── */}
      <Dialog open={addChapterFor !== null} onOpenChange={(o) => { if (!o) setAddChapterFor(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>New chapter</DialogTitle></DialogHeader>
          <Form {...chapterForm}>
            <form
              onSubmit={chapterForm.handleSubmit((v) => { if (addChapterFor) onCreateChapter(addChapterFor, v); })}
              className="space-y-4" noValidate
            >
              <FormField control={chapterForm.control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl><Input placeholder="e.g. Week 1" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAddChapterFor(null)}>Cancel</Button>
                <Button type="submit">Add chapter</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Add lesson dialog ────────────────────────────────────────────── */}
      <Dialog open={addLessonFor !== null} onOpenChange={(o) => { if (!o) setAddLessonFor(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>New lesson</DialogTitle></DialogHeader>
          <Form {...lessonForm}>
            <form
              onSubmit={lessonForm.handleSubmit((v) => { if (addLessonFor) onCreateLesson(addLessonFor, v); })}
              className="space-y-4" noValidate
            >
              <FormField control={lessonForm.control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl><Input placeholder="e.g. Photosynthesis" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={lessonForm.control} name="summary" render={({ field }) => (
                <FormItem>
                  <FormLabel>Summary</FormLabel>
                  <FormControl><Textarea rows={3} placeholder="Optional one-line summary" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAddLessonFor(null)}>Cancel</Button>
                <Button type="submit">Add lesson</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Add activity dialog ──────────────────────────────────────────── */}
      <Dialog open={addItemFor !== null} onOpenChange={(o) => { if (!o) setAddItemFor(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New activity</DialogTitle>
            <DialogDescription>Add a video, quiz or assignment to this lesson.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Activity type</Label>
              <Select
                value={itemKind}
                onValueChange={(v) => {
                  setItemKind(v as LessonItemKind);
                  setItemFile(null);
                  setItemAllowsFile(false);
                }}
              >
                <SelectTrigger aria-label="Activity type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="VIDEO">Video</SelectItem>
                  <SelectItem value="QUIZ">Quiz</SelectItem>
                  <SelectItem value="ASSIGNMENT">Assignment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="item-title">Title</Label>
              <Input id="item-title" value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} placeholder="e.g. Watch: The water cycle" />
            </div>
            {itemKind === 'VIDEO' ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="item-url">External video URL</Label>
                  <Input id="item-url" type="url" value={itemUrl} onChange={(e) => setItemUrl(e.target.value)} placeholder="https://youtube.com/watch?v=…" />
                  <p className="text-xs text-muted-foreground">
                    Provide a YouTube/Vimeo link, or upload a file below — this activity is
                    served from storage once uploaded and confirmed.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Separator className="flex-1" />
                  <span className="text-xs text-muted-foreground">or upload</span>
                  <Separator className="flex-1" />
                </div>
                <FilePicker
                  accept="video/mp4,video/webm,video/ogg,video/quicktime"
                  label="Choose video file"
                  name={itemFile ? itemFile.name : null}
                  onFile={setItemFile}
                  onClear={() => setItemFile(null)}
                  uploading={itemUploading}
                  progress={itemUploadProgress}
                />
              </div>
            ) : itemKind === 'ASSIGNMENT' ? (
              <div className="space-y-2">
                <Label htmlFor="item-instructions">Instructions</Label>
                <Textarea id="item-instructions" rows={3} value={itemInstructions} onChange={(e) => setItemInstructions(e.target.value)} placeholder="Optional instructions for learners" />
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={itemAllowsFile}
                    onCheckedChange={(v) => setItemAllowsFile(v === true)}
                  />
                  Allow file submissions
                </label>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="item-instructions">Instructions</Label>
                <Textarea id="item-instructions" rows={3} value={itemInstructions} onChange={(e) => setItemInstructions(e.target.value)} placeholder="Optional instructions for learners" />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddItemFor(null)}>Cancel</Button>
              <Button
                onClick={() => { if (addItemFor) onCreateItem(addItemFor); }}
                disabled={!itemTitle.trim() || itemUploading}
              >
                {itemUploading ? `Uploading… ${itemUploadProgress}%` : 'Add activity'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Assign to class ──────────────────────────────────────────────── */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign to a class</DialogTitle>
            <DialogDescription>Learners in the class get access to this course when it's published.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="assign-class">Class</Label>
              <Select value={assignClassId} onValueChange={setAssignClassId}>
                <SelectTrigger id="assign-class"><SelectValue placeholder="Choose a class" /></SelectTrigger>
                <SelectContent>
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name} · {c.academicYear}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {course.assignments.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground">Currently assigned to</p>
                <ul className="mt-1 space-y-1">
                  {course.assignments.map((a) => <li key={a.id} className="text-sm">{a.class.name}</li>)}
                </ul>
              </div>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
              <Button
                disabled={!assignClassId}
                onClick={async () => {
                  try { await assignToClass.mutateAsync(assignClassId); toast.success('Course assigned'); setAssignOpen(false); setAssignClassId(''); } catch {}
                }}
              >Assign</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}