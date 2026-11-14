import { type ReactNode, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  Activity, AlertCircle, ArrowUpRight, Check, ChevronRight,
  Eye, EyeOff, FileText, Fingerprint, HeartHandshake, KeyRound,
  LayoutDashboard, LockKeyhole, LogOut, Menu, MessageSquareText, Search,
  Shield, ShieldAlert, ShieldCheck, Users, X,
} from 'lucide-react';
import { Link, Redirect, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import {
  getGetAdminAccessQueryKey, getGetAdminAuditQueryKey, getGetAdminOverviewQueryKey,
  getGetAdminPostsQueryKey, getGetAdminReportsQueryKey, getGetAdminUsersQueryKey,
  useGetAdminAccess, useGetAdminAudit, useGetAdminOverview, useGetAdminPosts,
  useGetAdminReports, useGetAdminUsers, useUpdateAdminPost, useUpdateAdminReport,
  useUpdateAdminUser,
} from '@workspace/api-client-react';
import type {
  AdminAuditEvent, AdminOverview, AdminPost, AdminReport, AdminUser,
  GetAdminAuditParams, GetAdminPostsParams, GetAdminReportsParams, GetAdminUsersParams,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
function stripBase(path: string) { return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path; }

const appearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
  variables: {
    colorPrimary: '#34584d', colorForeground: '#253a34', colorMutedForeground: '#68756e',
    colorDanger: '#a64b42', colorBackground: '#fbf8f0', colorInput: '#f4f0e6',
    colorInputForeground: '#253a34', colorNeutral: '#253a34', fontFamily: 'DM Sans',
    borderRadius: '0.7rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fbf8f0] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[#ded8ca] shadow-[0_20px_50px_rgba(42,58,47,0.05)]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#253a34] font-semibold', headerSubtitle: 'text-[#68756e]',
    socialButtonsBlockButtonText: 'text-[#253a34]', formFieldLabel: 'text-[#344940]',
    footerActionLink: 'text-[#34584d]', footerActionText: 'text-[#68756e]',
    dividerText: 'text-[#68756e]', identityPreviewEditButton: 'text-[#34584d]',
    formFieldSuccessText: 'text-[#34584d]', alertText: 'text-[#253a34]',
    logoBox: 'rounded-lg', logoImage: 'rounded-lg', socialButtonsBlockButton: 'border-[#ded8ca]',
    formButtonPrimary: 'bg-[#34584d] hover:bg-[#28473d]', formFieldInput: 'bg-[#f4f0e6] border-[#ded8ca]',
    footerAction: 'border-t border-[#e4dfd5]', dividerLine: 'bg-[#ded8ca]',
    alert: 'border-[#ded8ca]', otpCodeFieldInput: 'bg-[#f4f0e6]',
    formFieldRow: 'text-[#344940]', main: 'text-[#253a34]',
  },
};

function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark ${small ? 'brand-mark-small' : ''}`} aria-hidden="true"><span /></span>;
}
function Brand({ inverse = false, small = false }: { inverse?: boolean; small?: boolean }) {
  return <div className={`brand-lockup ${inverse ? 'brand-inverse' : ''} ${small ? 'brand-small' : ''}`}><BrandMark small={small} /><span>The Secret Place<small>ADMIN CONSOLE</small></span></div>;
}
const routes = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/users', label: 'Aliases', icon: Users },
  { href: '/admin/posts', label: 'Vent posts', icon: MessageSquareText },
  { href: '/admin/reports', label: 'Safety reports', icon: ShieldAlert },
  { href: '/admin/audit', label: 'Audit trail', icon: Activity },
];
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}
function timeGreeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}
function initials(alias: string) { return alias.replace(/[^a-zA-Z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map(v => v[0]).join('').toUpperCase() || 'A'; }

function PublicHome() {
  return <main className="public-page noise min-h-[100dvh]">
    <header className="public-nav"><Brand /><Link href="/sign-in" className="quiet-link" data-testid="link-public-sign-in">Administrator sign in <ChevronRight size={15} /></Link></header>
    <section className="public-hero">
      <div className="hero-copy reveal">
        <div className="eyebrow"><span className="eyebrow-dot" /> PRIVATE OPERATIONS</div>
        <h1>A quieter kind<br />of <em>care.</em></h1>
        <p className="hero-lede">A private workspace for the people entrusted to keep The Secret Place safe, thoughtful, and human.</p>
        <Link href="/sign-in" className="primary-button hero-button" data-testid="button-public-sign-in">Sign in to continue <ChevronRight size={17} /></Link>
        <div className="hero-footnote"><LockKeyhole size={14} /> Access is limited to authorized administrators.</div>
      </div>
      <div className="hero-art" aria-label="Abstract illustration of a protected, calm space">
        <div className="orbit orbit-outer" /><div className="orbit orbit-inner" />
        <div className="art-sun" /><div className="art-crescent" />
        <div className="art-horizon" /><div className="art-arch"><span /></div>
        <div className="art-caption"><span>01 / THE PROMISE</span><span>Presence before process</span></div>
        <div className="art-seal"><ShieldCheck size={22} /><span>HELD<br />WITH CARE</span></div>
      </div>
    </section>
    <section className="promise-band">
      <div className="promise-lead"><span className="section-index">A NOTE ON TRUST</span><h2>Privacy is a practice,<br /><i>not a setting.</i></h2></div>
      <div className="promise-note"><p>This console is intentionally quiet. It contains no public community feed, and no personal identities. Administrators work only with pseudonymous aliases and the minimum context needed to support a safe space.</p><div className="promise-signature"><span className="signature-line" /> THE SECRET PLACE TEAM</div></div>
      <div className="promise-ornament"><Fingerprint size={35} strokeWidth={1} /><span>KNOWN BY<br />NO NAME</span></div>
    </section>
    <footer className="public-footer"><Brand small /><span>Private by design. Human by nature.</span><span className="mono">EST. FOR CARE</span></footer>
  </main>;
}
function HomeRoute() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div className="gate-loading"><Brand /><LoadingRows count={3} /></div>;
  if (isSignedIn) return <Redirect to="/admin" />;
  return <PublicHome />;
}

function SignInPage() {
  return <div className="auth-page noise"><div className="auth-side"><Brand /><div><span className="eyebrow"><span className="eyebrow-dot" /> A PRIVATE SPACE</span><h1>Here to<br /><em>hold the line.</em></h1><p>Sign in with your administrator account to continue.</p><div className="auth-note"><LockKeyhole size={16} /> Vent text is visible only where moderation requires it.</div></div><span className="mono auth-foot">THE SECRET PLACE / OPERATIONS</span></div><div className="auth-form"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div></div>;
}
function SignUpPage() {
  return <div className="auth-page noise"><div className="auth-side"><Brand /><div><span className="eyebrow"><span className="eyebrow-dot" /> ACCESS BY INVITATION</span><h1>A trusted<br /><em>presence.</em></h1><p>Create an administrator account only when you have been invited to do so.</p><div className="auth-note"><ShieldCheck size={16} /> Access is verified before platform data is shown.</div></div><span className="mono auth-foot">THE SECRET PLACE / OPERATIONS</span></div><div className="auth-form"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div></div>;
}

function PrivacyNotice({ compact = false }: { compact?: boolean }) {
  return <div className={`privacy-notice ${compact ? 'privacy-compact' : ''}`} data-testid="notice-privacy">
    <div className="privacy-icon"><LockKeyhole size={17} /></div>
    <div><strong>Moderator privacy notice</strong><p>Community members use pseudonymous aliases. Authorized administrators may read vent text only to review safety concerns and moderate content. Never seek or record a member’s real identity.</p></div>
  </div>;
}
function StatusPill({ value }: { value: string }) {
  const kind = value === 'active' || value === 'visible' || value === 'resolved' ? 'good' : value === 'open' || value === 'hidden' ? 'warm' : 'quiet';
  return <span className={`status-pill ${kind}`} data-testid={`status-${value}`}>{value.replaceAll('_', ' ')}</span>;
}
function LoadingRows({ count = 4 }: { count?: number }) {
  return <div className="skeleton-list" aria-label="Loading records" data-testid="loading-skeleton">{Array.from({ length: count }, (_, i) => <div className="skeleton-row" key={i}><i /><span /><span /></div>)}</div>;
}
function ErrorState({ retry, label = 'This section could not be loaded.' }: { retry: () => void; label?: string }) {
  return <div className="empty-state error-state"><div className="empty-icon"><AlertCircle size={22} /></div><h3>We couldn’t bring this through.</h3><p>{label} Your work is still safe. Try again in a moment.</p><button className="text-button" onClick={retry} data-testid="button-retry">Retry <ChevronRight size={15} /></button></div>;
}
function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><div className="empty-icon"><HeartHandshake size={22} /></div><h3>{title}</h3><p>{detail}</p></div>;
}
function PageTitle({ eyebrow, title, description, right }: { eyebrow: string; title: string; description: string; right?: ReactNode }) {
  return <div className="page-title"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{right}</div>;
}
function AdminShell({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  const [open, setOpen] = useState(false);
  const { signOut } = useClerk();
  return <div className="admin-shell">
    {open && <button aria-label="Close navigation" className="mobile-scrim" onClick={() => setOpen(false)} data-testid="button-close-navigation" />}
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="sidebar-brand"><Brand inverse /><button className="mobile-close" onClick={() => setOpen(false)} aria-label="Close navigation" data-testid="button-close-nav"><X size={18} /></button></div>
      <div className="workspace-label"><span className="workspace-seal"><Shield size={14} /></span><span>PRIVATE WORKSPACE<small>ADMINISTRATOR</small></span></div>
      <nav className="side-nav" aria-label="Administration">
        <span className="nav-caption">WORKSPACE</span>
        {routes.map(item => {
          const active = item.exact ? path === item.href : path.startsWith(item.href);
          const Icon = item.icon;
          return <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={`nav-item ${active ? 'nav-active' : ''}`} data-testid={`link-nav-${item.href.split('/').pop()}`}>
            <Icon size={17} strokeWidth={1.8} /><span>{item.label}</span>{item.href === '/admin/reports' && <span className="nav-indicator" />}
          </Link>;
        })}
      </nav>
      <div className="sidebar-bottom"><div className="sidebar-trust"><LockKeyhole size={15} /><span>Alias-only access<small>No personal identity data</small></span></div>
        <button className="signout-button" onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-sign-out"><LogOut size={16} /><span>Sign out</span></button>
      </div>
    </aside>
    <main className="admin-main"><header className="topbar"><button className="mobile-menu" onClick={() => setOpen(true)} aria-label="Open navigation" data-testid="button-open-nav"><Menu size={20} /></button><div className="crumb"><span>THE SECRET PLACE</span><ChevronRight size={13} /><span>ADMINISTRATION</span></div><div className="topbar-right"><span className="secure-indicator"><span /> SECURE SESSION</span><span className="topbar-avatar">A</span></div></header>{children}</main>
  </div>;
}

function AdminGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const access = useGetAdminAccess({ query: { enabled: Boolean(isLoaded && isSignedIn), queryKey: getGetAdminAccessQueryKey(), retry: false } });
  if (!isLoaded || (isSignedIn && access.isLoading)) return <div className="gate-loading"><Brand /><LoadingRows count={3} /></div>;
  if (!isSignedIn) return <div className="access-page"><Brand /><div className="access-card"><div className="access-icon"><KeyRound size={22} /></div><span className="eyebrow">AUTHENTICATION REQUIRED</span><h1>This door is for the team.</h1><p>Sign in with your administrator account to view the private operations console.</p><Link href="/sign-in" className="primary-button" data-testid="button-gate-sign-in">Administrator sign in <ChevronRight size={16} /></Link><Link href="/" className="back-link" data-testid="link-gate-home">Return to introduction</Link></div></div>;
  if (access.isError || access.data?.authorized !== true) return <div className="access-page"><Brand /><div className="access-card"><div className="access-icon warning"><ShieldAlert size={22} /></div><span className="eyebrow">ACCESS NOT GRANTED</span><h1>This space is restricted.</h1><p>Your signed-in account is not currently authorized for administrator access. No community data has been shown.</p><button className="outline-button" onClick={() => access.refetch()} data-testid="button-check-access">Check access again <ChevronRight size={16} /></button><Link href="/" className="back-link" data-testid="link-access-home">Return to introduction</Link></div></div>;
  return <AdminShell>{children}</AdminShell>;
}

function StatCard({ label, value, note, icon: Icon, tone = '' }: { label: string; value: number | undefined; note: string; icon: typeof Users; tone?: string }) {
  return <div className={`stat-card ${tone}`} data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}><div className="stat-top"><span>{label}</span><span className="stat-icon"><Icon size={17} /></span></div><strong>{value === undefined ? '—' : value.toLocaleString()}</strong><div className="stat-note">{note}</div></div>;
}
function OverviewPage() {
  const overview = useGetAdminOverview();
  const audit = useGetAdminAudit({ limit: 6 });
  const reports = useGetAdminReports({ status: 'open', limit: 4 });
  const data: AdminOverview | undefined = overview.data;
  return <div className="page-content reveal">
    <PageTitle eyebrow="PRIVATE OPERATIONS · OVERVIEW" title={`${timeGreeting()}, administrator.`} description="A considered view of the community, with the safety queue close at hand." right={<span className="overview-live"><span /> LIVE OVERVIEW</span>} />
    <PrivacyNotice />
    {overview.isLoading ? <LoadingRows count={4} /> : overview.isError ? <ErrorState retry={() => overview.refetch()} /> : <>
      <div className="metrics-grid">
        <StatCard label="Aliases" value={data?.totalUsers} note={`${data?.activeUsers ?? 0} active · ${data?.suspendedUsers ?? 0} paused`} icon={Users} />
        <StatCard label="Vent posts" value={data?.totalPosts} note={`${data?.postsLast24Hours ?? 0} shared in the last 24 hours`} icon={MessageSquareText} />
        <StatCard label="Open reports" value={data?.openReports} note={`${data?.reportsLast24Hours ?? 0} received in the last 24 hours`} icon={ShieldAlert} tone="metric-alert" />
        <StatCard label="Hidden posts" value={data?.hiddenPosts} note={`${data?.visiblePosts ?? 0} currently visible`} icon={EyeOff} />
      </div>
      <div className="overview-lower">
        <section className="surface-card report-preview"><div className="card-heading"><div><span className="section-index">NEEDS A LOOK</span><h2>Open reports</h2></div><Link href="/admin/reports" className="text-button" data-testid="link-all-reports">Review queue <ChevronRight size={15} /></Link></div>
          {reports.isLoading ? <LoadingRows count={2} /> : reports.isError ? <ErrorState retry={() => reports.refetch()} /> : reports.data?.items.length ? reports.data.items.map(report => <ReportPreview key={report.id} report={report} />) : <EmptyState title="Nothing waiting." detail="No open safety reports need your attention right now." />}
        </section>
        <section className="surface-card activity-preview"><div className="card-heading"><div><span className="section-index">A CLEAR RECORD</span><h2>Recent actions</h2></div><Link href="/admin/audit" className="text-button" data-testid="link-full-audit">Full trail <ChevronRight size={15} /></Link></div>
          {audit.isLoading ? <LoadingRows count={3} /> : audit.isError ? <ErrorState retry={() => audit.refetch()} /> : audit.data?.items.length ? audit.data.items.slice(0, 5).map(event => <AuditRow key={event.id} event={event} />) : <EmptyState title="A clean slate." detail="Moderator actions will be recorded here as they happen." />}
        </section>
      </div>
      <div className="overview-foot"><span><ShieldCheck size={15} /> Everything here is private to authorized administrators.</span><span className="mono">DATA REFRESHES ON VISIT</span></div>
    </>}
  </div>;
}

function ReportPreview({ report }: { report: AdminReport }) {
  return <Link href="/admin/reports" className="report-preview-row" data-testid={`row-open-report-${report.id}`}><span className="report-mark"><ShieldAlert size={16} /></span><span className="report-copy"><strong>{report.reason.replaceAll('_', ' ')}</strong><small>Post by {report.post.authorAlias} · {formatDate(report.createdAt)}</small></span><ChevronRight size={16} /></Link>;
}
function AuditRow({ event }: { event: AdminAuditEvent }) {
  const label: Record<string, string> = { user_suspended: 'Alias access paused', user_reactivated: 'Alias access restored', post_hidden: 'Vent post hidden', post_restored: 'Vent post restored', report_resolved: 'Safety report resolved', report_reopened: 'Safety report reopened' };
  return <div className="audit-row" data-testid={`row-audit-${event.id}`}><span className="audit-timeline-dot" /><div><strong>{label[event.action] || event.action.replaceAll('_', ' ')}</strong><small>{event.targetType} #{event.targetId}</small></div><time>{formatDate(event.createdAt)}</time></div>;
}

function UsersPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const params: GetAdminUsersParams = { search: search || undefined, status: status ? status as 'active' | 'suspended' : undefined, limit: 100 };
  const users = useGetAdminUsers(params);
  const mutation = useUpdateAdminUser();
  const qc = useQueryClient();
  const toggle = (user: AdminUser) => mutation.mutate({ userId: user.id, data: { status: user.status === 'active' ? 'suspended' : 'active' } }, {
    onSuccess: () => { qc.invalidateQueries({ queryKey: getGetAdminUsersQueryKey() }); qc.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() }); qc.invalidateQueries({ queryKey: getGetAdminAuditQueryKey() }); },
  });
  return <div className="page-content reveal">
    <PageTitle eyebrow="PEOPLE, WITHOUT IDENTITIES" title="Aliases" description="Manage community access through pseudonymous handles only." />
    <PrivacyNotice compact />
    <section className="surface-card table-card">
      <div className="table-toolbar"><div className="toolbar-title"><span className="section-index">COMMUNITY MEMBERS</span><span className="total-count">{users.data?.total ?? '—'} total</span></div><div className="filters"><label className="search-field"><Search size={16} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find an alias" aria-label="Search aliases" data-testid="input-search-users" /></label><select value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by access status" data-testid="select-user-status"><option value="">All access</option><option value="active">Active</option><option value="suspended">Suspended</option></select></div></div>
      {users.isLoading ? <LoadingRows /> : users.isError ? <ErrorState retry={() => users.refetch()} /> : users.data?.items.length ? <div className="table-scroll"><table><thead><tr><th>ALIAS</th><th>ACCESS</th><th>JOINED</th><th>POSTS</th><th>REPORTS</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{users.data.items.map(user => <tr key={user.id} data-testid={`row-user-${user.id}`}><td><div className="alias-cell"><span className="alias-avatar">{initials(user.alias)}</span><span><strong data-testid={`text-alias-${user.id}`}>{user.alias}</strong><small>Member · {user.id}</small></span></div></td><td><StatusPill value={user.status} /></td><td>{formatDate(user.joinedAt)}</td><td>{user.postsCount}</td><td><span className={user.reportsCount > 0 ? 'count-emphasis' : ''}>{user.reportsCount}</span></td><td><button className={`row-action ${user.status === 'active' ? 'action-pause' : 'action-restore'}`} disabled={mutation.isPending} onClick={() => toggle(user)} data-testid={`button-${user.status === 'active' ? 'suspend' : 'reactivate'}-${user.id}`}>{user.status === 'active' ? 'Pause access' : 'Restore access'}</button></td></tr>)}</tbody></table></div> : <EmptyState title="No aliases found." detail={search || status ? 'Try adjusting the search or access filter.' : 'Aliases will appear here as the community grows.'} />}
      {mutation.isError && <div className="inline-error" role="alert">That access change could not be saved. Please try again.</div>}
      <div className="table-foot"><span><Fingerprint size={14} /> No real names or contact details are available here.</span><span className="mono">ACCESS CHANGES ARE RECORDED</span></div>
    </section>
  </div>;
}

function ConcealedText({ content, id, label = 'Reveal vent text' }: { content: string; id: number; label?: string }) {
  const [revealed, setRevealed] = useState(false);
  return <div className={`concealed-text ${revealed ? 'is-revealed' : ''}`} data-testid={`text-concealed-${id}`}>
    {revealed ? <p>{content}</p> : <button onClick={() => setRevealed(true)} className="reveal-button" data-testid={`button-reveal-${id}`}><Eye size={15} /> {label}<span>Text is hidden until you choose to open it.</span></button>}
    {revealed && <button className="conceal-again" onClick={() => setRevealed(false)} data-testid={`button-conceal-${id}`}><EyeOff size={14} /> Conceal again</button>}
  </div>;
}
function PostsPage() {
  const [search, setSearch] = useState('');
  const [visibility, setVisibility] = useState('');
  const params: GetAdminPostsParams = { search: search || undefined, visibility: visibility ? visibility as 'visible' | 'hidden' : undefined, limit: 100 };
  const posts = useGetAdminPosts(params);
  const mutation = useUpdateAdminPost();
  const qc = useQueryClient();
  const toggle = (post: AdminPost) => mutation.mutate({ postId: post.id, data: { visibility: post.visibility === 'visible' ? 'hidden' : 'visible' } }, {
    onSuccess: () => { qc.invalidateQueries({ queryKey: getGetAdminPostsQueryKey() }); qc.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() }); qc.invalidateQueries({ queryKey: getGetAdminAuditQueryKey() }); },
  });
  return <div className="page-content reveal">
    <PageTitle eyebrow="CONTENT, HANDLED WITH CARE" title="Vent posts" description="Review posts when needed. Text stays concealed until you intentionally open it." />
    <PrivacyNotice compact />
    <section className="surface-card table-card">
      <div className="table-toolbar"><div className="toolbar-title"><span className="section-index">POST REVIEW</span><span className="total-count">{posts.data?.total ?? '—'} posts</span></div><div className="filters"><label className="search-field"><Search size={16} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search aliases or post IDs" aria-label="Search posts" data-testid="input-search-posts" /></label><select value={visibility} onChange={e => setVisibility(e.target.value)} aria-label="Filter post visibility" data-testid="select-post-visibility"><option value="">All visibility</option><option value="visible">Visible</option><option value="hidden">Hidden</option></select></div></div>
      {posts.isLoading ? <LoadingRows /> : posts.isError ? <ErrorState retry={() => posts.refetch()} /> : posts.data?.items.length ? <div className="post-list">{posts.data.items.map(post => <article className="post-record" key={post.id} data-testid={`card-post-${post.id}`}><div className="post-meta"><div className="alias-cell"><span className="alias-avatar">{initials(post.authorAlias)}</span><span><strong>{post.authorAlias}</strong><small>{formatDate(post.createdAt)}</small></span></div><div className="post-flags"><StatusPill value={post.visibility} />{post.reportsCount > 0 && <span className="report-count"><ShieldAlert size={13} /> {post.reportsCount} reports</span>}</div></div><ConcealedText id={post.id} content={post.content} /><div className="post-actions"><span className="mono">POST #{post.id}</span><button className={`row-action ${post.visibility === 'visible' ? 'action-pause' : 'action-restore'}`} disabled={mutation.isPending} onClick={() => toggle(post)} data-testid={`button-${post.visibility === 'visible' ? 'hide' : 'restore'}-post-${post.id}`}>{post.visibility === 'visible' ? <><EyeOff size={14} /> Hide post</> : <><Eye size={14} /> Restore post</>}</button></div></article>)}</div> : <EmptyState title="No posts in this view." detail="Try another visibility filter or search term." />}
      {mutation.isError && <div className="inline-error" role="alert">The post visibility change could not be saved. Please try again.</div>}
      <div className="table-foot"><span><EyeOff size={14} /> Post text is concealed by default.</span><span className="mono">MODERATION IS AUDITABLE</span></div>
    </section>
  </div>;
}

function ReportsPage() {
  const [status, setStatus] = useState('open');
  const params: GetAdminReportsParams = { status: status ? status as 'open' | 'resolved' : undefined, limit: 100 };
  const reports = useGetAdminReports(params);
  const mutation = useUpdateAdminReport();
  const qc = useQueryClient();
  const toggle = (report: AdminReport) => mutation.mutate({ reportId: report.id, data: { status: report.status === 'open' ? 'resolved' : 'open' } }, {
    onSuccess: () => { qc.invalidateQueries({ queryKey: getGetAdminReportsQueryKey() }); qc.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() }); qc.invalidateQueries({ queryKey: getGetAdminAuditQueryKey() }); },
  });
  const reasonTitle: Record<string, string> = { harassment: 'Harassment or targeted harm', personal_information: 'Personal information', self_harm_concern: 'Self-harm concern', spam: 'Spam or unwanted promotion', other: 'Other concern' };
  return <div className="page-content reveal">
    <PageTitle eyebrow="SAFETY, WITH A HUMAN RESPONSE" title="Safety reports" description="Review each concern deliberately. Resolve or reopen it when the next step is clear." right={<span className="queue-count"><ShieldAlert size={16} /> {reports.data?.items.filter(item => item.status === 'open').length ?? '—'} open</span>} />
    <PrivacyNotice compact />
    <div className="report-filter-bar"><div><span className="section-index">REVIEW QUEUE</span><span className="total-count">{reports.data?.total ?? '—'} reports</span></div><select value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter report status" data-testid="select-report-status"><option value="open">Open reports</option><option value="resolved">Resolved</option><option value="">All reports</option></select></div>
    {reports.isLoading ? <LoadingRows count={4} /> : reports.isError ? <ErrorState retry={() => reports.refetch()} /> : reports.data?.items.length ? <div className="reports-list">{reports.data.items.map(report => <article className="surface-card safety-card" key={report.id} data-testid={`card-report-${report.id}`}><div className="safety-top"><span className="safety-symbol"><ShieldAlert size={18} /></span><div className="safety-heading"><div><span className="section-index">REPORT #{report.id} · {formatDate(report.createdAt)}</span><h2>{reasonTitle[report.reason] || report.reason.replaceAll('_', ' ')}</h2></div><StatusPill value={report.status} /></div></div>{report.note && <div className="report-note"><span className="note-label">REPORTER’S NOTE</span><p>{report.note}</p></div>}<div className="reported-post"><div className="reported-post-head"><span><FileText size={14} /> REPORTED POST · BY {report.post.authorAlias.toUpperCase()}</span><StatusPill value={report.post.visibility} /></div><ConcealedText id={report.post.id + 1000000} content={report.post.content} label="Open reported vent text" /></div><div className="safety-actions"><span className="mono">POST #{report.post.id}</span><button className={`row-action ${report.status === 'open' ? 'action-restore' : 'action-pause'}`} disabled={mutation.isPending} onClick={() => toggle(report)} data-testid={`button-${report.status === 'open' ? 'resolve' : 'reopen'}-report-${report.id}`}>{report.status === 'open' ? <><Check size={14} /> Mark resolved</> : <><ArrowUpRight size={14} /> Reopen report</>}</button></div></article>)}</div> : <EmptyState title={status === 'open' ? 'No open reports.' : 'No reports in this view.'} detail={status === 'open' ? 'The queue is clear for now. New reports will appear here.' : 'Try changing the status filter.'} />}
    {mutation.isError && <div className="inline-error" role="alert">The report status could not be updated. Please try again.</div>}
  </div>;
}

function AuditPage() {
  const [limit, setLimit] = useState(25);
  const params: GetAdminAuditParams = { limit };
  const audit = useGetAdminAudit(params);
  return <div className="page-content reveal">
    <PageTitle eyebrow="A RECORD OF CAREFUL ACTION" title="Audit trail" description="A transparent record of moderation actions. No private vent text is shown here." />
    <div className="audit-intro"><div className="audit-intro-mark"><Activity size={18} /></div><p>Every access change, post visibility update, and report decision is recorded with a timestamp and target reference.</p></div>
    <section className="surface-card audit-card"><div className="table-toolbar"><div className="toolbar-title"><span className="section-index">RECENT MODERATION ACTIVITY</span><span className="total-count">{audit.data?.items.length ?? '—'} events</span></div><select value={limit} onChange={e => setLimit(Number(e.target.value))} aria-label="Number of audit events" data-testid="select-audit-limit"><option value={25}>Latest 25</option><option value={50}>Latest 50</option><option value={100}>Latest 100</option></select></div>
      {audit.isLoading ? <LoadingRows count={5} /> : audit.isError ? <ErrorState retry={() => audit.refetch()} /> : audit.data?.items.length ? <div className="audit-list">{audit.data.items.map(event => <AuditDetail key={event.id} event={event} />)}</div> : <EmptyState title="No actions recorded yet." detail="Moderation activity will appear here as decisions are made." />}
      <div className="table-foot"><span><ShieldCheck size={14} /> Decisions remain visible to authorized administrators.</span><span className="mono">APPEND-ONLY RECORD</span></div>
    </section>
  </div>;
}
function AuditDetail({ event }: { event: AdminAuditEvent }) {
  const labels: Record<string, string> = { user_suspended: 'Access paused', user_reactivated: 'Access restored', post_hidden: 'Vent post hidden', post_restored: 'Vent post restored', report_resolved: 'Report resolved', report_reopened: 'Report reopened' };
  const detail: Record<string, string> = { user_suspended: 'Alias access was suspended', user_reactivated: 'Alias access was returned to active', post_hidden: 'A vent post was removed from view', post_restored: 'A vent post was returned to view', report_resolved: 'A safety report was marked resolved', report_reopened: 'A safety report was returned to the open queue' };
  return <div className="audit-detail" data-testid={`row-audit-detail-${event.id}`}><div className="audit-detail-icon"><span /></div><div className="audit-detail-main"><div className="audit-detail-title"><strong>{labels[event.action] || event.action.replaceAll('_', ' ')}</strong><StatusPill value={event.targetType} /></div><p>{detail[event.action] || 'A moderation action was recorded'} · {event.targetType} <b>#{event.targetId}</b></p><time>{formatDate(event.createdAt)}</time></div><span className="audit-event-id mono">EVT-{event.id}</span></div>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
function ProtectedOverview() { return <AdminGate><OverviewPage /></AdminGate>; }
function ProtectedUsers() { return <AdminGate><UsersPage /></AdminGate>; }
function ProtectedPosts() { return <AdminGate><PostsPage /></AdminGate>; }
function ProtectedReports() { return <AdminGate><ReportsPage /></AdminGate>; }
function ProtectedAudit() { return <AdminGate><AuditPage /></AdminGate>; }
function ClerkRoutes() {
  const [, setLocation] = useLocation();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  const { addListener } = useClerk();
  const qc = useQueryClient();
  useEffect(() => addListener(({ user }) => {
    const userId = user?.id ?? null;
    if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) qc.clear();
    prevUserIdRef.current = userId;
  }), [addListener, qc]);
  return <Switch>
    <Route path="/" component={HomeRoute} />
    <Route path="/sign-in/*?" component={SignInPage} />
    <Route path="/sign-up/*?" component={SignUpPage} />
    <Route path="/admin" component={ProtectedOverview} />
    <Route path="/admin/users" component={ProtectedUsers} />
    <Route path="/admin/posts" component={ProtectedPosts} />
    <Route path="/admin/reports" component={ProtectedReports} />
    <Route path="/admin/audit" component={ProtectedAudit} />
    <Route component={NotFound} />
  </Switch>;
}
function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={appearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}
      localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to the private operations console.' } }, signUp: { start: { title: 'Administrator access', subtitle: 'Create an invited administrator account.' } } }}
      routerPush={to => setLocation(stripBase(to))} routerReplace={to => setLocation(stripBase(to), { replace: true })}>
      <RoutedErrorBoundary><ClerkRoutes /></RoutedErrorBoundary>
    </ClerkProvider>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={basePath}>
    <ClerkProviderWithRoutes />
    <Toaster />
  </WouterRouter></TooltipProvider></QueryClientProvider>;
}
export default App;
