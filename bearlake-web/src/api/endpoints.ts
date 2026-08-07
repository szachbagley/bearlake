import type {
  Announcement,
  AnnouncementPage,
  CalendarEvent,
  ChangePasswordRequest,
  CreateAnnouncementRequest,
  CreateArticleRequest,
  CreateCategoryRequest,
  CreateEventRequest,
  CreateQuickTipRequest,
  CreateUserRequest,
  CreateUserResponse,
  InfoArticle,
  InfoCategory,
  ListAnnouncementsQuery,
  ListArticleSummariesResponse,
  ListCategoriesResponse,
  ListEventsQuery,
  ListEventsResponse,
  ListQuickTipsResponse,
  ListUsersResponse,
  LoginRequest,
  LogoutRequest,
  PresignUploadRequest,
  PresignUploadResponse,
  PublicUser,
  QuickTip,
  RefreshRequest,
  ResetPasswordResponse,
  SessionResult,
  UpdateAnnouncementRequest,
  UpdateArticleRequest,
  UpdateCategoryRequest,
  UpdateEventRequest,
  UpdateQuickTipRequest,
  UpdateUserRequest,
} from '../types/api.ts';
import { request } from './client.ts';

/**
 * One typed function per route (plan step 6), matching the server's response
 * envelopes exactly (plan W12): list endpoints return a named wrapper,
 * single-entity endpoints return the entity bare, DELETE/logout return
 * nothing. Grouped by resource in the same order as the server's routers.
 *
 * `signal` is accepted wherever a request is a natural fit for `useQuery`
 * (plan W3) so callers can wire up abort-on-unmount; mutations don't need it.
 */

export interface RequestSignal {
  signal?: AbortSignal;
}

// ── Auth ─────────────────────────────────────────────────────────────────

/** No token exists yet — never goes through the 401 refresh cycle. */
export function login(body: LoginRequest): Promise<SessionResult> {
  return request<SessionResult>('/auth/login', { method: 'POST', body, skipAuth: true });
}

/** IS the recovery mechanism — must never try to recover from its own 401. */
export function refresh(body: RefreshRequest): Promise<SessionResult> {
  return request<SessionResult>('/auth/refresh', { method: 'POST', body, skipAuth: true });
}

export function logout(body: LogoutRequest): Promise<void> {
  return request<void>('/auth/logout', { method: 'POST', body });
}

export function changePassword(body: ChangePasswordRequest): Promise<SessionResult> {
  return request<SessionResult>('/auth/change-password', { method: 'POST', body });
}

export function me(options: RequestSignal = {}): Promise<PublicUser> {
  return request<PublicUser>('/me', { signal: options.signal });
}

// ── Users (admin) ────────────────────────────────────────────────────────

export function listUsers(options: RequestSignal = {}): Promise<ListUsersResponse> {
  return request<ListUsersResponse>('/users', { signal: options.signal });
}

export function createUser(body: CreateUserRequest): Promise<CreateUserResponse> {
  return request<CreateUserResponse>('/users', { method: 'POST', body });
}

export function updateUser(id: string, body: UpdateUserRequest): Promise<PublicUser> {
  return request<PublicUser>(`/users/${id}`, { method: 'PATCH', body });
}

export function resetUserPassword(id: string): Promise<ResetPasswordResponse> {
  return request<ResetPasswordResponse>(`/users/${id}/reset-password`, { method: 'POST' });
}

// ── Events ───────────────────────────────────────────────────────────────

export function listEvents(
  query: ListEventsQuery,
  options: RequestSignal = {},
): Promise<ListEventsResponse> {
  return request<ListEventsResponse>('/events', { query, signal: options.signal });
}

export function createEvent(body: CreateEventRequest): Promise<CalendarEvent> {
  return request<CalendarEvent>('/events', { method: 'POST', body });
}

export function getEvent(id: string, options: RequestSignal = {}): Promise<CalendarEvent> {
  return request<CalendarEvent>(`/events/${id}`, { signal: options.signal });
}

export function updateEvent(id: string, body: UpdateEventRequest): Promise<CalendarEvent> {
  return request<CalendarEvent>(`/events/${id}`, { method: 'PATCH', body });
}

export function deleteEvent(id: string): Promise<void> {
  return request<void>(`/events/${id}`, { method: 'DELETE' });
}

// ── Announcements ────────────────────────────────────────────────────────

export function listAnnouncements(
  query: ListAnnouncementsQuery = {},
  options: RequestSignal = {},
): Promise<AnnouncementPage> {
  return request<AnnouncementPage>('/announcements', { query, signal: options.signal });
}

export function createAnnouncement(body: CreateAnnouncementRequest): Promise<Announcement> {
  return request<Announcement>('/announcements', { method: 'POST', body });
}

export function updateAnnouncement(
  id: string,
  body: UpdateAnnouncementRequest,
): Promise<Announcement> {
  return request<Announcement>(`/announcements/${id}`, { method: 'PATCH', body });
}

export function deleteAnnouncement(id: string): Promise<void> {
  return request<void>(`/announcements/${id}`, { method: 'DELETE' });
}

// ── Quick tips ───────────────────────────────────────────────────────────

export function listQuickTips(options: RequestSignal = {}): Promise<ListQuickTipsResponse> {
  return request<ListQuickTipsResponse>('/quick-tips', { signal: options.signal });
}

export function createQuickTip(body: CreateQuickTipRequest): Promise<QuickTip> {
  return request<QuickTip>('/quick-tips', { method: 'POST', body });
}

export function updateQuickTip(id: string, body: UpdateQuickTipRequest): Promise<QuickTip> {
  return request<QuickTip>(`/quick-tips/${id}`, { method: 'PATCH', body });
}

export function deleteQuickTip(id: string): Promise<void> {
  return request<void>(`/quick-tips/${id}`, { method: 'DELETE' });
}

// ── Knowledge base ───────────────────────────────────────────────────────

export function listCategories(options: RequestSignal = {}): Promise<ListCategoriesResponse> {
  return request<ListCategoriesResponse>('/info/categories', { signal: options.signal });
}

export function createCategory(body: CreateCategoryRequest): Promise<InfoCategory> {
  return request<InfoCategory>('/info/categories', { method: 'POST', body });
}

export function updateCategory(id: string, body: UpdateCategoryRequest): Promise<InfoCategory> {
  return request<InfoCategory>(`/info/categories/${id}`, { method: 'PATCH', body });
}

export function deleteCategory(id: string): Promise<void> {
  return request<void>(`/info/categories/${id}`, { method: 'DELETE' });
}

export function listArticlesByCategory(
  categoryId: string,
  options: RequestSignal = {},
): Promise<ListArticleSummariesResponse> {
  return request<ListArticleSummariesResponse>(`/info/categories/${categoryId}/articles`, {
    signal: options.signal,
  });
}

export function getArticle(id: string, options: RequestSignal = {}): Promise<InfoArticle> {
  return request<InfoArticle>(`/info/articles/${id}`, { signal: options.signal });
}

export function createArticle(body: CreateArticleRequest): Promise<InfoArticle> {
  return request<InfoArticle>('/info/articles', { method: 'POST', body });
}

export function updateArticle(id: string, body: UpdateArticleRequest): Promise<InfoArticle> {
  return request<InfoArticle>(`/info/articles/${id}`, { method: 'PATCH', body });
}

export function deleteArticle(id: string): Promise<void> {
  return request<void>(`/info/articles/${id}`, { method: 'DELETE' });
}

// ── Uploads (admin) ──────────────────────────────────────────────────────

export function presignUpload(body: PresignUploadRequest): Promise<PresignUploadResponse> {
  return request<PresignUploadResponse>('/uploads/presign', { method: 'POST', body });
}
