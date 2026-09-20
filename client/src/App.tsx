import { useEffect, useState, createContext, useContext } from "react";
import { Router, Route, Switch, Link, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Form } from "@/components/ui/form";
import DanceCards from "@/components/DanceCards";
import { apiRequest, queryClient, setAuthToken } from "@/lib/queryClient";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Users,
  FileText,
  LockKeyhole,
  Sun,
  Moon,
  Menu,
  X,
  LogOut,
  LayoutDashboard,
  Settings,
  ChevronRight,
  MapPin,
  Check,
  Download,
  Mail,
  Plus,
  ShieldCheck,
  Search,
  Bell,
  HeartHandshake,
} from "lucide-react";

type User = { id: number; name: string; email: string; role: string; bio: string; listed: boolean };
type Event = {
  id: number;
  title: string;
  date: string;
  location: string;
  description: string;
  visibility: string;
  rsvped?: boolean;
  attendeeCount?: number;
};
const Auth = createContext<{
  user: User | null;
  login: (data: any) => void;
  logout: () => void;
  updateUser: (user: User) => void;
}>({ user: null, login: () => {}, logout: () => {}, updateUser: () => {} });
const clubName = "Chinese American Bridge Club";
const dateFormat = (date: string) =>
  new Date(date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const timeFormat = (date: string) =>
  new Date(date).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
const refresh = () => {
  queryClient.invalidateQueries();
};

function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? "small" : ""}`}>
      <img
        className="club-logo"
        src="./images/club-logo.png"
        width="404"
        height="448"
        alt="中美橋牌會 · Chinese American Bridge Club logo"
        data-testid={small ? "img-footer-logo" : "img-header-logo"}
      />
      <span>
        Chinese American<span>Bridge Club</span>
      </span>
    </span>
  );
}
function AppShell() {
  const [user, setUser] = useState<User | null>(null);
  const [dark, setDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const [mobile, setMobile] = useState(false);
  const [path, navigate] = useLocation();
  const login = (data: any) => {
    setAuthToken(data.token);
    queryClient.clear();
    setUser(data.user);
    navigate("/members");
  };
  const logout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch {}
    setAuthToken(null);
    setUser(null);
    queryClient.clear();
    navigate("/login");
  };
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  useEffect(() => {
    setMobile(false);
    window.scrollTo(0, 0);
    document.title = `${path.startsWith("/members") ? "Member hub" : path === "/about" ? "About the club" : path === "/events" ? "Games & events" : path === "/contact" ? "Contact" : path === "/login" ? "Member sign in" : "Duplicate bridge, shared community"} | ${clubName}`;
  }, [path]);
  return (
    <Auth.Provider value={{ user, login, logout, updateUser: setUser }}>
      <a
        className="skip"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
        data-testid="link-skip"
      >
        Skip to content
      </a>
      <header className="header">
        <div className="header-inner">
          <Link href="/" aria-label="Club home" data-testid="link-logo">
            <Logo />
          </Link>
          <nav aria-label="Main navigation" className={mobile ? "public-nav open" : "public-nav"}>
            {[
              ["/", "Home"],
              ["/about", "Our club"],
              ["/events", "Games & events"],
              ["/contact", "Contact"],
            ].map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className={path === href ? "active" : ""}
                aria-current={path === href ? "page" : undefined}
                data-testid={`link-${label.toLowerCase().replaceAll(" ", "-")}`}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="header-actions">
            <button
              className="icon-button theme"
              title={`Switch to ${dark ? "light" : "dark"} mode`}
              aria-label={`Switch to ${dark ? "light" : "dark"} mode`}
              data-testid="button-theme"
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <Link
              href={user ? "/members" : "/login"}
              className="button member-button"
              data-testid="link-member-login"
            >
              <LockKeyhole size={15} />
              <span>{user ? "Member hub" : "Member sign in"}</span>
            </Link>
            <button
              className="icon-button hamburger"
              aria-label={mobile ? "Close navigation" : "Open navigation"}
              aria-expanded={mobile}
              data-testid="button-menu"
              onClick={() => setMobile(!mobile)}
            >
              {mobile ? <X /> : <Menu />}
            </button>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/about" component={About} />
          <Route path="/events" component={Events} />
          <Route path="/contact" component={Contact} />
          <Route path="/login" component={Login} />
          <Route path="/members" component={MemberHub} />
          <Route>
            <div className="page narrow">
              <p className="eyebrow">A little off course</p>
              <h1>Let’s get you back to the table.</h1>
              <Link href="/" className="button">
                Back to home <ArrowRight size={17} />
              </Link>
            </div>
          </Route>
        </Switch>
      </main>
      <footer>
        <div className="footer-inner">
          <Link href="/" data-testid="link-footer-home">
            <Logo small />
          </Link>
          <p>
            A shared love of the game.
            <br />A place to belong.
          </p>
          <div className="footer-links">
            <Link href="/contact" data-testid="link-footer-contact">
              Get in touch <ArrowUpRight size={16} />
            </Link>
            <Link href="/login" data-testid="link-footer-members">
              Members <ArrowUpRight size={16} />
            </Link>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Chinese American Bridge Club</span>
          <span>Made with Perplexity Computer</span>
        </div>
      </footer>
    </Auth.Provider>
  );
}
function usePublic() {
  return useQuery<any>({ queryKey: ["/api/public"] });
}
function LoadState({ query }: { query: any }) {
  return query.isError ? (
    <div className="notice error" role="alert">
      <p>We couldn’t load the club information. Please try again.</p>
      <button className="text-button" data-testid="button-retry" onClick={() => query.refetch()}>
        Try again <ArrowRight size={16} />
      </button>
    </div>
  ) : (
    <div className="loading" role="status" aria-label="Loading club information">
      <div />
      <div />
      <div />
    </div>
  );
}
function Home() {
  const q = usePublic();
  return (
    <>
      <section className="hero wrap">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="tiny-rule" />
            THE CHINESE AMERICAN BRIDGE CLUB
          </p>
          <h1>
            Good cards.
            <br />
            Great company.
          </h1>
          <p className="hero-description">
            A shared table. A thoughtful game. A community brought together by duplicate bridge.
          </p>
          <div className="hero-actions">
            <Link href="/events" className="button" data-testid="link-explore-games">
              Find your next game <ArrowRight size={18} />
            </Link>
            <Link href="/about" className="text-button" data-testid="link-about-hero">
              Get to know us <ArrowUpRight size={17} />
            </Link>
          </div>
          <div className="hero-note">
            <span className="suits" aria-hidden="true">
              ♠ <i>♥</i> ♣ <i>♦</i>
            </span>
            <span>Partners in play. Friends beyond the table.</span>
          </div>
        </div>
        <div className="hero-image">
          <img
            src="./images/bridge-table.webp"
            alt="Playing cards and a red plastic duplicate board on a burgundy bridge table"
            width="1376"
            height="1024"
            fetchPriority="high"
            onError={(e) => {
              e.currentTarget.style.visibility = "hidden";
            }}
          />
          <div className="image-label">
            <span>THE GAME BRINGS US TOGETHER</span>
            <span>
              LET’S PLAY <ArrowUpRight size={16} />
            </span>
          </div>
        </div>
      </section>
      <div className="club-strip">
        <div className="wrap">
          <span>
            <span className="red-suit" aria-hidden="true">
              ♦
            </span>{" "}
            Thoughtful play
          </span>
          <span>Lasting partnerships</span>
          <span>A welcoming table</span>
          <Link href="/contact" data-testid="link-first-visit">
            New to the club? Say hello <ArrowRight size={16} />
          </Link>
        </div>
      </div>
      <section className="wrap home-events">
        <div className="section-head">
          <div>
            <p className="eyebrow">AROUND THE TABLE</p>
            <h2>Your next game starts here.</h2>
          </div>
          <Link href="/events" className="text-button" data-testid="link-all-events">
            All games & events <ArrowRight size={17} />
          </Link>
        </div>
        {q.isLoading || q.isError ? (
          <LoadState query={q} />
        ) : (
          <>
            <div className="events-layout">
              <div>
                {q.data.events.length ? (
                  q.data.events
                    .slice(0, 2)
                    .map((event: Event) => <EventCard event={event} key={event.id} />)
                ) : (
                  <div className="schedule-empty">
                    <CalendarDays size={28} />
                    <div>
                      <h3>The next deal is on its way.</h3>
                      <p>{q.data.settings.scheduleNote || "Game dates will be announced here."}</p>
                      <Link
                        href="/contact"
                        className="text-button"
                        data-testid="link-schedule-contact"
                      >
                        Ask about upcoming games <ArrowRight size={16} />
                      </Link>
                    </div>
                  </div>
                )}
              </div>
              <aside className="visit-note">
                <p className="eyebrow">YOUR FIRST VISIT</p>
                <h3>There’s a seat for you.</h3>
                <p>
                  Have a question about playing with us, finding a partner, or becoming a member?
                  We’d love to hear from you.
                </p>
                <Link href="/contact" className="text-button" data-testid="link-visit-contact">
                  Let’s connect <ArrowUpRight size={17} />
                </Link>
              </aside>
            </div>
          </>
        )}
      </section>
      <section className="member-band wrap">
        <div>
          <p className="eyebrow">A LITTLE MORE, FOR MEMBERS</p>
          <h2>The club, between games.</h2>
          <p>Stay in the loop, find familiar faces, and plan your next session.</p>
        </div>
        <Link href="/login" className="button light" data-testid="link-open-hub">
          Enter the member hub <LockKeyhole size={17} />
        </Link>
      </section>
    </>
  );
}
function PageHeading({
  label,
  title,
  description,
}: {
  label: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-heading">
      <p className="eyebrow">{label}</p>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
function About() {
  const q = usePublic();
  return (
    <div className="wrap page">
      <PageHeading
        label="OUR CLUB"
        title="More than a game. A connection."
        description="The Chinese American Bridge Club brings people together around the bridge table."
      />
      <div className="about-layout">
        <img
          src="./images/bridge-table.webp"
          width="700"
          height="600"
          alt="Cards and a red plastic duplicate bridge board ready for play"
        />
        <div className="about-copy">
          <p className="eyebrow">A SHARED LOVE OF BRIDGE</p>
          <h2>
            A thoughtful game.
            <br />A welcoming community.
          </h2>
          {q.isLoading || q.isError ? (
            <LoadState query={q} />
          ) : (
            <p className="prewrap">{q.data.settings.about}</p>
          )}
          <div className="about-line">
            <HeartHandshake size={25} />
            <div>
              <h3>Come for the bridge.</h3>
              <p>Meet fellow players and enjoy time at the table.</p>
            </div>
          </div>
          <div className="about-line">
            <Users size={25} />
            <div>
              <h3>Stay for the people.</h3>
              <p>Connect with the club about membership and your first visit.</p>
            </div>
          </div>
          <Link href="/contact" className="button" data-testid="link-about-contact">
            Get in touch <ArrowRight size={17} />
          </Link>
        </div>
      </div>
    </div>
  );
}
function EventCard({
  event,
  member = false,
  onChange,
}: {
  event: Event;
  member?: boolean;
  onChange?: () => void;
}) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  async function rsvp() {
    setPending(true);
    setError("");
    try {
      await apiRequest("POST", `/api/member/events/${event.id}/rsvp`, { attending: !event.rsvped });
      refresh();
      onChange?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPending(false);
    }
  }
  return (
    <article className="event-card" data-testid={`card-event-${event.id}`}>
      <div className="event-date">
        <span>
          {new Date(event.date).toLocaleDateString("en-US", { month: "short" }).toUpperCase()}
        </span>
        <strong>{new Date(event.date).getDate()}</strong>
      </div>
      <div className="event-info">
        <div className="event-meta">
          <span>{event.visibility === "members" ? "MEMBERS ONLY" : "DUPLICATE BRIDGE"}</span>
        </div>
        <h3>{event.title}</h3>
        <p>
          {dateFormat(event.date)} · {timeFormat(event.date)}
        </p>
        <p>
          <MapPin size={14} />
          {event.location || "Location to be announced"}
        </p>
        {event.description && <p className="event-description">{event.description}</p>}
        {member && (
          <small>
            {event.attendeeCount || 0} member{event.attendeeCount === 1 ? "" : "s"} attending
          </small>
        )}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
      </div>
      {member ? (
        <button
          className={`button ${event.rsvped ? "secondary" : ""}`}
          data-testid={`button-rsvp-${event.id}`}
          disabled={pending}
          onClick={rsvp}
        >
          {pending ? (
            "Saving…"
          ) : event.rsvped ? (
            <>
              <Check size={16} /> Attending · Cancel
            </>
          ) : (
            "RSVP"
          )}
          {!event.rsvped && <Plus size={16} />}
        </button>
      ) : (
        <Link
          href="/login"
          className="icon-button"
          aria-label={`Sign in to RSVP for ${event.title}`}
          data-testid={`link-rsvp-${event.id}`}
        >
          <ArrowUpRight size={22} />
        </Link>
      )}
    </article>
  );
}
function Events() {
  const q = usePublic();
  const [filter, setFilter] = useState("upcoming");
  const events = (q.data?.events || []).filter((e: Event) =>
    filter === "upcoming"
      ? new Date(e.date).getTime() >= Date.now()
      : new Date(e.date).getTime() < Date.now(),
  );
  return (
    <div className="wrap page">
      <PageHeading
        label="GAMES & EVENTS"
        title="Make time for a good game."
        description="Find a session, plan your visit, and join us at the table."
      />
      <div className="event-page-layout">
        <div>
          <div className="tabs" role="tablist" aria-label="Game dates">
            {["upcoming", "past"].map((s) => (
              <button
                role="tab"
                aria-selected={filter === s}
                className={filter === s ? "selected" : ""}
                key={s}
                data-testid={`button-${s}`}
                onClick={() => setFilter(s)}
              >
                {s === "upcoming" ? "Upcoming games" : "Past games"}
              </button>
            ))}
          </div>
          {q.isLoading || q.isError ? (
            <LoadState query={q} />
          ) : events.length ? (
            events.map((e: Event) => <EventCard key={e.id} event={e} />)
          ) : (
            <Empty
              icon={CalendarDays}
              title={filter === "upcoming" ? "The next deal is on its way." : "A fresh start."}
              text={
                filter === "upcoming"
                  ? q.data.settings.scheduleNote
                  : "Past games will appear here after your club’s first listed event."
              }
            />
          )}
        </div>
        <aside className="panel">
          <p className="eyebrow">PLAN YOUR VISIT</p>
          <h3>Before you join us</h3>
          <p>
            Check each game’s details for its start time and location. Members can sign in to RSVP.
          </p>
          <hr />
          <p className="small-copy">CLUB VENUE</p>
          <p>{q.data?.settings.venue || "Please contact the club for venue details."}</p>
          <Link href="/contact" className="text-button" data-testid="link-event-question">
            Ask a question <ArrowRight size={17} />
          </Link>
        </aside>
      </div>
    </div>
  );
}
type Field = {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  hint?: string;
  minLength?: number;
  maxLength?: number;
};
function DataForm({
  fields,
  initial = {},
  submitLabel,
  onSubmit,
  successText,
  onDone,
}: {
  fields: Field[];
  initial?: any;
  submitLabel: string;
  onSubmit: (values: any) => Promise<any>;
  successText?: string;
  onDone?: (result: any) => void;
}) {
  const form = useForm({
    defaultValues: Object.fromEntries(
      fields.map((f) => [
        f.name,
        initial[f.name] ??
          (f.type === "checkbox" ? false : f.type === "select" ? f.options?.[0]?.value || "" : ""),
      ]),
    ),
  });
  const [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  async function submit(values: any) {
    setError("");
    setSuccess("");
    try {
      const result = await onSubmit(values);
      setSuccess(successText || "Saved successfully.");
      onDone?.(result);
    } catch (e: any) {
      setError(e.message || "We couldn’t save that. Please try again.");
    }
  }
  return (
    <Form {...form}>
      <form className="data-form" onSubmit={form.handleSubmit(submit)}>
        {fields.map((f) => (
          <div className={`field ${f.type === "checkbox" ? "check-field" : ""}`} key={f.name}>
            <label htmlFor={`field-${f.name}`}>
              {f.label}
              {f.required && <span aria-hidden="true"> *</span>}
            </label>
            {f.type === "textarea" ? (
              <textarea
                id={`field-${f.name}`}
                rows={4}
                data-testid={`input-${f.name}`}
                {...form.register(f.name, {
                  required: f.required,
                  minLength: f.minLength,
                  maxLength: f.maxLength || 10000,
                })}
                required={f.required}
                maxLength={f.maxLength || 10000}
              />
            ) : f.type === "select" ? (
              <select
                id={`field-${f.name}`}
                data-testid={`input-${f.name}`}
                {...form.register(f.name)}
              >
                {f.options?.map((o) => (
                  <option value={o.value} key={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`field-${f.name}`}
                type={f.type || "text"}
                data-testid={`input-${f.name}`}
                {...form.register(f.name, {
                  required: f.required,
                  minLength: f.minLength,
                  maxLength: f.maxLength || 1000,
                })}
                required={f.required}
                minLength={f.minLength}
                maxLength={f.maxLength || 1000}
                autoComplete={
                  f.type === "password"
                    ? "new-password"
                    : f.name === "email"
                      ? "email"
                      : f.name === "name"
                        ? "name"
                        : "off"
                }
              />
            )}
            {f.hint && <small>{f.hint}</small>}
            {form.formState.errors[f.name] && (
              <small className="error-text" role="alert">
                Please check {f.label.toLowerCase()}
                {f.minLength ? ` (at least ${f.minLength} characters)` : ""}.
              </small>
            )}
          </div>
        ))}
        {error && (
          <div className="notice error" role="alert" data-testid="status-form-error">
            {error}
          </div>
        )}
        {success && (
          <div className="notice success" role="status" data-testid="status-form-success">
            <Check size={17} />
            {success}
          </div>
        )}
        <button
          className="button"
          type="submit"
          disabled={form.formState.isSubmitting}
          data-testid="button-submit"
        >
          {form.formState.isSubmitting ? "Please wait…" : submitLabel}
          <ArrowRight size={17} />
        </button>
      </form>
    </Form>
  );
}
function Contact() {
  const q = usePublic();
  return (
    <div className="wrap page">
      <PageHeading
        label="GET IN TOUCH"
        title="Every partnership starts with hello."
        description="Questions about games, membership, or your first visit? Send a note to the club."
      />
      <div className="contact-layout">
        <div className="contact-intro">
          <Mail size={30} />
          <h2>We’d like to hear from you.</h2>
          <p>
            Tell us a little about yourself and how we can help. Your message will be saved to the
            club administrator’s inbox.
          </p>
          <div className="contact-details">
            <p className="eyebrow">WHERE WE PLAY</p>
            <p>{q.data?.settings.venue || "Contact us for venue details."}</p>
            {q.data?.settings.contactEmail && (
              <>
                <p className="eyebrow">EMAIL THE CLUB</p>
                <a href={`mailto:${q.data.settings.contactEmail}`} data-testid="link-contact-email">
                  {q.data.settings.contactEmail}
                </a>
              </>
            )}
          </div>
          <small>
            We use your name and email to respond to your inquiry. Contact messages are visible only
            to club administrators.
          </small>
        </div>
        <div className="panel">
          <DataForm
            fields={[
              { name: "name", label: "Your name", required: true, maxLength: 100 },
              {
                name: "email",
                label: "Email address",
                type: "email",
                required: true,
                maxLength: 254,
              },
              {
                name: "message",
                label: "How can we help?",
                type: "textarea",
                required: true,
                minLength: 10,
                maxLength: 5000,
              },
            ]}
            submitLabel="Send to club inbox"
            onSubmit={async (d) => (await apiRequest("POST", "/api/contact", d)).json()}
            successText="Your message is in the club inbox. Thank you for getting in touch."
          />
        </div>
      </div>
    </div>
  );
}
function Login() {
  const { user, login } = useContext(Auth);
  const [, navigate] = useLocation();
  const status = useQuery<any>({ queryKey: ["/api/auth/status"] });
  const [mode, setMode] = useState("login");
  if (user)
    return (
      <div className="wrap page">
        <PageHeading
          label="MEMBERS"
          title="You’re already signed in."
          description="Your community is just a click away."
        />
        <Link href="/members" className="button">
          Go to member hub <ArrowRight size={17} />
        </Link>
      </div>
    );
  const titles: Record<string, string> = {
    login: "Good to see you again.",
    accept: "Your seat is waiting.",
    setup: "Make the club your own.",
    reset: "A fresh start.",
  };
  const fields: Field[] = [
    ...(mode !== "login"
      ? [
          {
            name: "code",
            label:
              mode === "setup"
                ? "Owner setup code"
                : mode === "reset"
                  ? "Recovery code"
                  : "Invitation code",
            required: true,
          },
        ]
      : []),
    ...(["accept", "setup"].includes(mode)
      ? [{ name: "name", label: "Full name", required: true, maxLength: 100 }]
      : []),
    { name: "email", label: "Email address", type: "email", required: true, maxLength: 254 },
    {
      name: "password",
      label: mode === "login" ? "Password" : "Choose a password",
      type: "password",
      required: true,
      minLength: mode === "login" ? undefined : 12,
      maxLength: 128,
      hint:
        mode === "login"
          ? undefined
          : "Use at least 12 characters. Choose a password you don’t use elsewhere.",
    },
  ];
  return (
    <div className="wrap login-page">
      <div className="login-story">
        <p className="eyebrow">THE MEMBER HUB</p>
        <h1>
          The club is always
          <br />
          close at hand.
        </h1>
        <p>
          Your private space for the people, plans, and conversations that keep our club connected.
        </p>
        <ul>
          {[
            [Bell, "Club announcements"],
            [CalendarDays, "Games and RSVPs"],
            [Users, "Member directory"],
            [FileText, "Documents and resources"],
          ].map(([Icon, text]: any) => (
            <li key={text}>
              <Icon size={19} />
              {text}
            </li>
          ))}
        </ul>
        <div className="login-privacy">
          <ShieldCheck size={21} />
          <p>
            Invitation-only access.
            <br />
            Member information stays within the club.
          </p>
        </div>
      </div>
      <section className="login-panel">
        <div className="login-title">
          <LockKeyhole size={25} />
          <span className="eyebrow">
            {mode === "login"
              ? "MEMBER SIGN IN"
              : mode === "setup"
                ? "OWNER SETUP"
                : mode === "reset"
                  ? "PASSWORD RECOVERY"
                  : "ACTIVATE MEMBERSHIP"}
          </span>
        </div>
        <h2>{titles[mode]}</h2>
        <p>
          {mode === "login"
            ? "Sign in to catch up with your club."
            : mode === "setup"
              ? "Use the private setup code provided with your website."
              : mode === "reset"
                ? "Ask your club administrator for a recovery code."
                : "Use the invitation code from your club administrator."}
        </p>
        <DataForm
          key={mode}
          fields={fields}
          submitLabel={
            mode === "login" ? "Sign in" : mode === "reset" ? "Reset password" : "Create account"
          }
          onSubmit={async (d) => (await apiRequest("POST", `/api/auth/${mode}`, d)).json()}
          onDone={(data) => {
            if (mode === "reset") {
              setMode("login");
              navigate("/login");
            } else login(data);
          }}
        />
        <div className="login-links">
          {mode !== "login" && (
            <button
              className="text-button"
              data-testid="button-mode-login"
              onClick={() => setMode("login")}
            >
              Back to sign in <ArrowRight size={15} />
            </button>
          )}
          {mode === "login" && (
            <>
              <button
                className="text-button"
                data-testid="button-mode-accept"
                onClick={() => setMode("accept")}
              >
                Have an invitation? Activate your account <ArrowRight size={15} />
              </button>
              <button
                className="subtle-button"
                data-testid="button-mode-reset"
                onClick={() => setMode("reset")}
              >
                Forgot your password?
              </button>
            </>
          )}
          {status.data?.setupRequired && mode !== "setup" && (
            <button
              className="subtle-button"
              data-testid="button-mode-setup"
              onClick={() => setMode("setup")}
            >
              Club administrator? Complete first-time setup
            </button>
          )}
        </div>
        <p className="session-note">For privacy, refreshing or closing this page signs you out.</p>
      </section>
    </div>
  );
}
function Empty({ icon: Icon, title, text }: { icon: any; title: string; text: string }) {
  return (
    <div className="empty">
      <Icon size={30} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function MemberHub() {
  const { user, logout, updateUser } = useContext(Auth);
  const [tab, setTab] = useState("overview"),
    [search, setSearch] = useState(""),
    [downloadError, setDownloadError] = useState("");
  const q = useQuery<any>({ queryKey: ["/api/member/hub"], enabled: !!user, staleTime: 0 });
  if (!user) return <Login />;
  const tabs: any[] = [
    ["overview", "Overview", LayoutDashboard],
    ["dance", "Games & Dance Cards", HeartHandshake],
    ["directory", "Member directory", Users],
    ["documents", "Documents", FileText],
    ["profile", "My profile", Settings],
    ...(user.role === "admin" ? [["admin", "Club administration", ShieldCheck]] : []),
  ];
  async function download(id: number) {
    setDownloadError("");
    try {
      const d = await (await apiRequest("GET", `/api/member/documents/${id}`)).json();
      const url = URL.createObjectURL(new Blob([d.content], { type: "text/plain" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = d.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      setDownloadError(e.message);
    }
  }
  return (
    <div className="hub wrap">
      <aside className="hub-sidebar">
        <div className="sidebar-title">
          <LockKeyhole size={15} /> MEMBER HUB
        </div>
        <nav aria-label="Member navigation">
          {tabs.map(([id, label, Icon]) => (
            <button
              key={id}
              className={tab === id ? "selected" : ""}
              data-testid={`button-tab-${id}`}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              <Icon size={18} />
              {label}
              {tab === id && <ChevronRight size={15} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-profile">
          <span className="avatar">{user.name.charAt(0)}</span>
          <div>
            <strong>{user.name}</strong>
            <small>{user.role === "admin" ? "Club administrator" : "Club member"}</small>
          </div>
        </div>
        <button className="text-button" onClick={logout} data-testid="button-logout">
          <LogOut size={16} /> Sign out
        </button>
      </aside>
      <section className="hub-content">
        <div className="hub-heading">
          <p className="eyebrow">YOUR CLUB, CONNECTED</p>
          <h1>
            {tab === "overview"
              ? `Welcome back, ${user.name.split(" ")[0]}.`
              : tabs.find((t) => t[0] === tab)?.[1]}
          </h1>
          <p>
            {tab === "overview"
              ? "Here’s what’s happening around the table."
              : tab === "dance"
                ? "Find your partner. Plan your Mondays. Keep both cards in step."
                : tab === "directory"
                  ? "Find familiar faces. Only members who opt in are listed."
                  : tab === "documents"
                    ? "Club resources, shared privately with members."
                    : tab === "events"
                      ? "Plan your next game and let the club know you’re coming."
                      : tab === "profile"
                        ? "Choose what you share with your fellow members."
                        : "Keep your club information and membership up to date."}
          </p>
        </div>
        {q.isLoading || q.isError ? (
          <LoadState query={q} />
        ) : (
          <>
            {tab === "overview" && (
              <>
                <div className="hub-welcome">
                  <div>
                    <span className="eyebrow">YOU’RE IN GOOD COMPANY</span>
                    <h2>See you at the next game.</h2>
                    <p>RSVP, arrange your partner, and see who’s playing in one place.</p>
                  </div>
                  <button
                    className="button light"
                    data-testid="button-hub-view-games"
                    onClick={() => setTab("dance")}
                  >
                    View games <ArrowRight size={17} />
                  </button>
                </div>
                <div className="section-head compact">
                  <h2>Club announcements</h2>
                  <Bell size={20} />
                </div>
                {q.data.announcements.length ? (
                  q.data.announcements.map((a: any) => (
                    <article className="announcement" key={a.id}>
                      <small>{dateFormat(a.createdAt)}</small>
                      <h3>{a.title}</h3>
                      <p className="prewrap">{a.body}</p>
                    </article>
                  ))
                ) : (
                  <Empty
                    icon={Bell}
                    title="A quiet moment between games."
                    text="Club announcements will appear here. Check back for updates from your administrator."
                  />
                )}
              </>
            )}
            {tab === "directory" && (
              <>
                <div className="search-field">
                  <Search size={18} />
                  <label className="sr-only" htmlFor="directory-search">
                    Search members
                  </label>
                  <input
                    id="directory-search"
                    data-testid="input-directory-search"
                    placeholder="Search members by name…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="directory-grid">
                  {q.data.members
                    .filter((m: User) => m.name.toLowerCase().includes(search.toLowerCase()))
                    .map((m: User) => (
                      <article className="directory-card" key={m.id}>
                        <span className="avatar">{m.name.charAt(0)}</span>
                        <h3>{m.name}</h3>
                        <p>{m.bio || "Club member"}</p>
                        <a href={`mailto:${m.email}`} data-testid={`link-email-${m.id}`}>
                          <Mail size={15} /> Email member
                        </a>
                      </article>
                    ))}
                </div>
                {!q.data.members.filter((m: User) =>
                  m.name.toLowerCase().includes(search.toLowerCase()),
                ).length && (
                  <Empty
                    icon={Users}
                    title={search ? "No matching members." : "Meet your fellow players."}
                    text={
                      search
                        ? "Try a different name."
                        : "Members will appear here when they choose to share their profile. You can opt in under My profile."
                    }
                  />
                )}
              </>
            )}
            {tab === "documents" && (
              <>
                {downloadError && (
                  <div className="notice error" role="alert">
                    {downloadError}
                  </div>
                )}
                {q.data.documents.length ? (
                  q.data.documents.map((d: any) => (
                    <article className="document-row" key={d.id}>
                      <FileText size={26} />
                      <div>
                        <h3>{d.title}</h3>
                        <p>{d.description}</p>
                        <small>{d.filename}</small>
                      </div>
                      <button
                        className="button secondary"
                        data-testid={`button-download-${d.id}`}
                        onClick={() => download(d.id)}
                      >
                        <Download size={17} /> Download
                      </button>
                    </article>
                  ))
                ) : (
                  <Empty
                    icon={FileText}
                    title="A home for the helpful things."
                    text="Your administrator can add text documents, club notes, and other written resources here."
                  />
                )}
              </>
            )}
            {tab === "profile" && (
              <div className="panel form-panel">
                <DataForm
                  initial={{
                    name: q.data.user.name,
                    bio: q.data.user.bio || "",
                    listed: !!q.data.user.listed,
                  }}
                  fields={[
                    { name: "name", label: "Display name", required: true, maxLength: 100 },
                    { name: "bio", label: "A little about you", type: "textarea", maxLength: 1000 },
                    {
                      name: "listed",
                      label: "List my name, email, and bio in the member directory",
                      type: "checkbox",
                      hint: "Off by default. Only signed-in members can see the directory.",
                    },
                  ]}
                  submitLabel="Save profile"
                  successText="Your profile preferences have been saved."
                  onSubmit={async (d) => {
                    const r = await (await apiRequest("PATCH", "/api/member/profile", d)).json();
                    updateUser(r);
                    refresh();
                    return r;
                  }}
                />
                <p className="session-note">Account email: {q.data.user.email}</p>
              </div>
            )}
            {tab === "dance" && <DanceCards user={user} />}
            {tab === "admin" && <Admin />}
          </>
        )}
      </section>
    </div>
  );
}
function Admin() {
  const q = useQuery<any>({ queryKey: ["/api/admin"], staleTime: 0 });
  const [action, setAction] = useState(""),
    [generated, setGenerated] = useState<any>(null);
  const actions: any[] = [
    ["invite", "Invite a member", Users],
    ["event", "Add a game", CalendarDays],
    ["announcement", "Post an announcement", Bell],
    ["document", "Add a text document", FileText],
    ["settings", "Club details", Settings],
    ["reset", "Password recovery", LockKeyhole],
  ];
  const fields: Record<string, Field[]> = {
    invite: [
      {
        name: "email",
        label: "Member email address",
        type: "email",
        required: true,
        maxLength: 254,
      },
    ],
    reset: [
      {
        name: "email",
        label: "Member email address",
        type: "email",
        required: true,
        maxLength: 254,
      },
    ],
    event: [
      { name: "title", label: "Game title", required: true, maxLength: 160 },
      {
        name: "date",
        label: "Date and start time",
        type: "datetime-local",
        required: true,
        hint: "Entered in your device’s local timezone.",
      },
      { name: "location", label: "Venue or online game details", required: true, maxLength: 300 },
      { name: "description", label: "Game details", type: "textarea", maxLength: 5000 },
      {
        name: "visibility",
        label: "Who can see this game?",
        type: "select",
        options: [
          { value: "public", label: "Everyone (public)" },
          { value: "members", label: "Members only" },
        ],
      },
    ],
    announcement: [
      { name: "title", label: "Announcement title", required: true, maxLength: 160 },
      { name: "body", label: "Announcement", type: "textarea", required: true, maxLength: 10000 },
    ],
    document: [
      { name: "title", label: "Document title", required: true, maxLength: 160 },
      { name: "description", label: "Short description", maxLength: 500 },
      {
        name: "content",
        label: "Document text",
        type: "textarea",
        required: true,
        maxLength: 50000,
        hint: "Saved as a downloadable .txt file. Visible only to signed-in members.",
      },
    ],
    settings: [
      { name: "about", label: "About the club", type: "textarea", required: true, maxLength: 5000 },
      { name: "venue", label: "Club venue", maxLength: 300 },
      { name: "contactEmail", label: "Public contact email", type: "email", maxLength: 254 },
      { name: "scheduleNote", label: "Schedule message", type: "textarea", maxLength: 1000 },
    ],
  };
  const paths: Record<string, string> = {
    invite: "invites",
    event: "events",
    announcement: "announcements",
    document: "documents",
    settings: "settings",
    reset: "reset",
  };
  if (q.isLoading || q.isError) return <LoadState query={q} />;
  return (
    <>
      <div className="admin-actions">
        {actions.map(([id, label, Icon]) => (
          <button
            key={id}
            className={action === id ? "selected" : ""}
            data-testid={`button-admin-${id}`}
            onClick={() => {
              setAction(action === id ? "" : id);
              setGenerated(null);
            }}
          >
            <Icon size={19} />
            <span>{label}</span>
            <Plus size={16} />
          </button>
        ))}
      </div>
      {action && (
        <section className="panel admin-form">
          <div className="section-head compact">
            <h2>{actions.find((a) => a[0] === action)[1]}</h2>
            <button
              className="icon-button"
              aria-label="Close editor"
              data-testid="button-close-editor"
              onClick={() => {
                setAction("");
                setGenerated(null);
              }}
            >
              <X size={19} />
            </button>
          </div>
          {["invite", "reset"].includes(action) && (
            <p className="form-intro">
              Create a single-use code and share it privately with the member. No email is sent
              automatically.
            </p>
          )}
          <DataForm
            key={action}
            fields={fields[action]}
            initial={
              action === "settings"
                ? q.data.settings
                : action === "event"
                  ? { visibility: "public" }
                  : {}
            }
            submitLabel={
              ["invite", "reset"].includes(action)
                ? "Create private code"
                : action === "settings"
                  ? "Save club details"
                  : "Add to club"
            }
            successText={
              ["invite", "reset"].includes(action)
                ? "Private code created. Share it only with its intended recipient."
                : "Saved to the club."
            }
            onSubmit={async (d) => {
              if (action === "event") d.date = new Date(d.date).toISOString();
              const r = await (
                await apiRequest(
                  action === "settings" ? "PATCH" : "POST",
                  `/api/admin/${paths[action]}`,
                  d,
                )
              ).json();
              refresh();
              if (r.code) setGenerated({ ...r, email: d.email });
              return r;
            }}
          />
          {generated && (
            <div className="code-result" role="status">
              <strong>For {generated.email}</strong>
              <label htmlFor="private-code">
                Single-use {action === "reset" ? "recovery" : "invitation"} code
              </label>
              <input
                id="private-code"
                data-testid="text-private-code"
                value={generated.code}
                readOnly
                onFocus={(e) => e.target.select()}
              />
              <small>
                Expires {dateFormat(generated.expiresAt)} · {timeFormat(generated.expiresAt)}. The
                member enters this on the sign-in page under{" "}
                {action === "reset" ? "“Forgot your password?”" : "“Have an invitation?”"}.
              </small>
            </div>
          )}
        </section>
      )}
      <div className="section-head compact">
        <h2>Club members</h2>
        <span className="badge">{q.data.members.length}</span>
      </div>
      <div className="member-admin-list">
        {q.data.members.map((m: any) => (
          <div key={m.id}>
            <span className="avatar">{m.name.charAt(0)}</span>
            <span>
              <strong>{m.name}</strong>
              <small>{m.email}</small>
            </span>
            <span className="badge">{m.role}</span>
          </div>
        ))}
      </div>
      <div className="section-head compact">
        <h2>Contact inbox</h2>
        <Mail size={20} />
      </div>
      {q.data.inquiries.length ? (
        q.data.inquiries.map((i: any) => (
          <article className="inquiry" key={i.id}>
            <div>
              <h3>{i.name}</h3>
              <small>{dateFormat(i.createdAt)}</small>
            </div>
            <a href={`mailto:${i.email}`} data-testid={`link-inquiry-${i.id}`}>
              {i.email}
            </a>
            <p className="prewrap">{i.message}</p>
          </article>
        ))
      ) : (
        <Empty
          icon={Mail}
          title="All caught up."
          text="Messages sent through the public contact form will appear here. Only club administrators can read them."
        />
      )}
    </>
  );
}
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={useHashLocation}>
        <AppShell />
      </Router>
    </QueryClientProvider>
  );
}
