import { useState } from "react";
import "./dance-cards.css";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Form } from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { CalendarDays, RefreshCw, Printer } from "lucide-react";
import type { DanceHub, DanceScheduleInput } from "@shared/schema";

const displayDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const key = ["/api/member/dance"];
type Action = { url: string; body: unknown; message: string };
type Confirmation = { title: string; description: string; action: Action };
type Game = DanceHub["games"][number];

export default function DanceCards({ user }: { user: { id: number; name: string; role: string } }) {
  const cache = useQueryClient();
  const q = useQuery<DanceHub>({
    queryKey: key,
    staleTime: 0,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });
  const [cardId, setCardId] = useState(user.id);
  const [history, setHistory] = useState(false);
  const [notice, setNotice] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const refresh = async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: key }),
      cache.invalidateQueries({ queryKey: ["/api/member/hub"] }),
    ]);
  };
  const mutation = useMutation({
    mutationFn: async (action: Action) =>
      (await apiRequest("POST", action.url, action.body)).json(),
    onSuccess: async (_data, action) => {
      setConfirmation(null);
      setNotice(action.message);
      await refresh();
    },
    onError: async () => {
      setNotice("");
      setConfirmation(null);
      await refresh();
    },
  });
  function act(action: Action) {
    setNotice("");
    mutation.mutate(action);
  }
  if (q.isPending)
    return (
      <div className="dance-loading" role="status">
        Loading games and dance cards…
      </div>
    );
  if (!q.data)
    return (
      <div className="notice error" role="alert">
        <p>{q.error?.message || "The schedule could not be loaded."}</p>
        <button className="button secondary" onClick={() => q.refetch()}>
          Try again
        </button>
      </div>
    );
  const data = q.data;
  const names = new Map(data.players.map((p) => [p.id, p.name]));
  const games = data.games.filter((g) => history || g.date >= data.today);
  const pending = mutation.isPending;
  return (
    <div className="dance-area">
      <p className="dance-explainer">
        Your RSVP and partnership, together. Booking a partner marks both of you as playing. Agree
        with your partner before booking.
      </p>
      {!data.enrolled && (
        <section className="panel dance-enrollment">
          <h3>Join the partner roster</h3>
          <p>
            You can RSVP without joining. Opt in to show your name and dance card to signed-in
            members and let available members book you as their agreed partner.
          </p>
          <button
            className="button"
            data-testid="button-dance-join"
            disabled={pending}
            onClick={() =>
              act({
                url: "/api/member/dance/enrollment",
                body: { enrolled: true },
                message: "You’re on the partner roster.",
              })
            }
          >
            Join Dance Cards
          </button>
        </section>
      )}
      <div aria-live="polite">
        {notice && (
          <div className="notice success" data-testid="status-dance-success">
            {notice}
          </div>
        )}
      </div>
      {mutation.isError && (
        <div className="notice error" role="alert" data-testid="status-dance-error">
          {mutation.error.message}
        </div>
      )}
      {q.isError && (
        <div className="notice error" role="alert">
          The latest refresh failed. Please refresh before booking.
        </div>
      )}
      <div className="dance-toolbar">
        <label className="dance-card-picker">
          Dance card
          <select
            data-testid="select-dance-member"
            value={cardId}
            onChange={(e) => setCardId(Number(e.target.value))}
          >
            <option value={user.id}>My dance card</option>
            {data.players
              .filter((p) => p.id !== user.id)
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <label className="dance-history">
          <input
            type="checkbox"
            data-testid="input-dance-history"
            checked={history}
            onChange={(e) => setHistory(e.target.checked)}
          />{" "}
          Include past dates
        </label>
        <button
          className="text-button"
          disabled={q.isFetching}
          data-testid="button-dance-refresh"
          onClick={() => {
            setNotice("");
            q.refetch();
          }}
        >
          <RefreshCw size={16} /> Refresh
        </button>
      </div>
      <p className="dance-caption">
        One row per date. Regular Monday games start at 11:30 a.m. Pacific. Use “View pairs” for
        game details and the full lineup.
        <span className="dance-mobile-hint">
          Swipe the table sideways to see partners and playing pairs.
        </span>
      </p>
      {!games.length ? (
        <div className="empty">
          <CalendarDays size={28} />
          <h3>No {history ? "" : "upcoming "}dates yet.</h3>
          <p>Your club administrator can add dates below.</p>
        </div>
      ) : (
        <div
          className="dance-table-scroll"
          role="region"
          aria-label="Games and dance cards, scroll horizontally on small screens"
          tabIndex={0}
        >
          <table className="dance-table" data-testid="table-dance-schedule">
            <caption className="sr-only">
              RSVPs and dance cards, one row per date. All dates use San Francisco time.
            </caption>
            <thead>
              <tr>
                <th scope="col">Game date</th>
                <th scope="col">{cardId === user.id ? "My RSVP" : "RSVP"}</th>
                <th scope="col">{cardId === user.id ? "My partner" : "Partner"}</th>
                <th scope="col">Playing pairs</th>
              </tr>
            </thead>
            <tbody>
              {games.map((game) => (
                <DanceRow
                  key={`${cardId}-${game.id}`}
                  game={game}
                  data={data}
                  names={names}
                  selectedId={cardId}
                  user={user}
                  pending={pending || q.isError}
                  act={act}
                  confirm={setConfirmation}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="dance-caption">
        Available = opted into the roster, not paired, and not marked “Not playing.” An unanswered
        RSVP is not a commitment. Cards refresh every 30 seconds. RSVP applies to all games listed
        on that date; past dates are read-only.
      </p>
      {user.role === "admin" && (
        <section className="panel dance-admin">
          <div className="section-head compact">
            <div>
              <h3>Manage the Monday schedule</h3>
              <p>Add weekly dates without changing existing games.</p>
            </div>
            <button
              className="button secondary"
              data-testid="button-dance-schedule-toggle"
              aria-expanded={scheduleOpen}
              onClick={() => setScheduleOpen(!scheduleOpen)}
            >
              {scheduleOpen ? "Close" : "Add dates"}
            </button>
          </div>
          {scheduleOpen && (
            <ScheduleForm
              today={data.today}
              onSave={async (input) => {
                const result = await (
                  await apiRequest("POST", "/api/admin/dance/schedule", input)
                ).json();
                await refresh();
                return `${result.created} date${result.created === 1 ? "" : "s"} added. Existing dates were not changed.`;
              }}
            />
          )}
        </section>
      )}
      {data.enrolled && (
        <div className="dance-leave">
          <p>
            Your dance card is visible only to signed-in members. Leaving the roster does not cancel
            your RSVPs.
          </p>
          <button
            className="text-button"
            data-testid="button-dance-leave"
            disabled={pending}
            onClick={() =>
              act({
                url: "/api/member/dance/enrollment",
                body: { enrolled: false },
                message: "You’ve left the partner roster. Your RSVPs are unchanged.",
              })
            }
          >
            Leave Dance Cards
          </button>
        </div>
      )}
      <Dialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirmation(null);
        }}
      >
        <DialogContent className="dance-modal">
          <DialogTitle>{confirmation?.title}</DialogTitle>
          <DialogDescription>{confirmation?.description}</DialogDescription>
          <div className="dance-modal-actions">
            <button
              className="button"
              data-testid="button-dance-confirm"
              disabled={pending}
              onClick={() => confirmation && act(confirmation.action)}
            >
              {pending ? "Saving…" : "Confirm"}
            </button>
            <button
              className="button secondary"
              disabled={pending}
              onClick={() => setConfirmation(null)}
            >
              Go back
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DanceRow({
  game,
  data,
  names,
  selectedId,
  user,
  pending,
  act,
  confirm,
}: {
  game: Game;
  data: DanceHub;
  names: Map<number, string>;
  selectedId: number;
  user: { id: number; role: string };
  pending: boolean;
  act: (action: Action) => void;
  confirm: (value: Confirmation) => void;
}) {
  const [partner, setPartner] = useState("");
  const slots = data.slots.filter((s) => s.gameId === game.id);
  const mine = slots.find((s) => s.userId === user.id);
  const selected = slots.find((s) => s.userId === selectedId);
  const attendance = data.attendance.find((a) => a.gameId === game.id && a.userId === selectedId);
  const myAttendance = data.attendance.find((a) => a.gameId === game.id && a.userId === user.id);
  const past = game.date < data.today;
  const own = selectedId === user.id;
  const available = data.players.filter(
    (p) => p.id !== user.id && game.availablePlayerIds.includes(p.id),
  );
  const canBook =
    data.enrolled && !past && mine?.status !== "booked" && myAttendance?.attending !== false;
  const canCancel =
    selected?.status === "booked" &&
    !past &&
    (own || selected.partnerId === user.id || user.role === "admin");
  const pairs = slots.filter(
    (s) => s.status === "booked" && s.partnerId !== null && s.userId < s.partnerId,
  );
  const action = (body: unknown, route: string, message: string): Action => ({
    url: `/api/member/dance/games/${game.id}/${route}`,
    body,
    message,
  });
  function book(partnerId: number) {
    confirm({
      title: "Book this partnership?",
      description: `Record ${names.get(partnerId)} as your agreed partner on ${displayDate(game.date)}? Both cards will update and both players will be marked as playing.`,
      action: action(
        { partnerId },
        "book",
        "Partnership booked. Both players are RSVP’d as playing.",
      ),
    });
    setPartner("");
  }
  return (
    <tr data-testid={`card-dance-game-${game.id}`} className={past ? "past" : ""}>
      <th scope="row">
        <time dateTime={game.date}>{displayDate(game.date)}</time>
      </th>
      <td>
        {own && !past ? (
          <select
            aria-label={`My RSVP for ${displayDate(game.date)}`}
            data-testid={`select-dance-rsvp-${game.id}`}
            disabled={pending}
            value={attendance ? (attendance.attending ? "yes" : "no") : ""}
            onChange={(e) => {
              const attending = e.target.value === "yes";
              const request = action(
                {
                  attending,
                  ...(!attending && mine?.bookingId ? { bookingId: mine.bookingId } : {}),
                },
                "rsvp",
                attending ? "You’re marked as playing." : "You’re marked as not playing.",
              );
              if (!attending && mine?.status === "booked")
                confirm({
                  title: "Cancel your place and partnership?",
                  description: `You will be marked as not playing on ${displayDate(game.date)}. Your partnership will be cancelled on both cards; your partner will remain RSVP’d as playing without a partner. Please let them know.`,
                  action: request,
                });
              else act(request);
            }}
          >
            <option value="" disabled>
              No reply
            </option>
            <option value="yes">Playing</option>
            <option value="no">Not playing</option>
          </select>
        ) : (
          <span className={`dance-status ${attendance?.attending ? "booked" : ""}`}>
            {attendance ? (attendance.attending ? "Playing" : "Not playing") : "No reply"}
          </span>
        )}
      </td>
      <td>
        <div className="dance-partner-cell">
          {selected?.status === "booked" ? (
            <>
              <span className="dance-status booked" data-testid={`status-dance-slot-${game.id}`}>
                {names.get(selected.partnerId!) || "Former participant"}
              </span>
              {canCancel && (
                <button
                  className="text-button"
                  disabled={pending}
                  data-testid={`button-dance-cancel-${game.id}`}
                  onClick={() =>
                    confirm({
                      title: "Cancel this partnership?",
                      description: `Both players will stay RSVP’d as playing on ${displayDate(game.date)}, without a partner. Please notify your partner.`,
                      action: action(
                        { bookingId: selected.bookingId },
                        "cancel",
                        "Partnership cancelled. Both RSVPs remain as playing.",
                      ),
                    })
                  }
                >
                  Cancel pair
                </button>
              )}
            </>
          ) : own && canBook ? (
            <>
              <select
                aria-label={`Available partners for ${displayDate(game.date)}`}
                data-testid={`select-dance-partner-${game.id}`}
                disabled={pending || !available.length}
                value={available.some((p) => String(p.id) === partner) ? partner : ""}
                onChange={(e) => setPartner(e.target.value)}
              >
                <option value="">
                  {available.length ? "Available partners" : "No members available"}
                </option>
                {available.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {slots.some((s) => s.userId === p.id && s.status === "standby")
                      ? " · standby"
                      : ""}
                  </option>
                ))}
              </select>
              <button
                className="button"
                data-testid={`button-dance-book-${game.id}`}
                disabled={pending || !available.some((p) => String(p.id) === partner)}
                onClick={() => book(Number(partner))}
              >
                Book
              </button>
            </>
          ) : !own && canBook && available.some((p) => p.id === selectedId) ? (
            <button
              className="button secondary"
              disabled={pending}
              data-testid={`button-dance-book-member-${game.id}`}
              onClick={() => book(selectedId)}
            >
              Book with me
            </button>
          ) : (
            <span className="dance-muted" data-testid={`status-dance-slot-${game.id}`}>
              {attendance?.attending === false
                ? "Unavailable"
                : selected?.status === "standby"
                  ? "On standby"
                  : "No partner"}
            </span>
          )}
          {own &&
            data.enrolled &&
            !past &&
            mine?.status !== "booked" &&
            myAttendance?.attending !== false && (
              <button
                className="text-button dance-standby-toggle"
                disabled={pending}
                data-testid={`button-dance-standby-${game.id}`}
                onClick={() =>
                  act(
                    action(
                      { standby: mine?.status !== "standby" },
                      "standby",
                      mine?.status === "standby"
                        ? "You’ve left standby. Your RSVP is unchanged."
                        : "You’re on standby and RSVP’d as playing.",
                    ),
                  )
                }
              >
                {mine?.status === "standby" ? "Leave standby" : "Standby"}
              </button>
            )}
        </div>
      </td>
      <td>
        <Dialog>
          <DialogTrigger asChild>
            <button
              className="text-button dance-pairs-button"
              data-testid={`button-dance-pairs-${game.id}`}
            >
              View pairs ({pairs.length})
            </button>
          </DialogTrigger>
          <DialogContent className="dance-modal dance-lineup">
            <div className="dance-print-only dance-print-heading">
              <h1>Chinese American Bridge Club</h1>
              <p>Member pair list · {displayDate(game.date)}</p>
            </div>
            <DialogTitle>Playing on {displayDate(game.date)}</DialogTitle>
            <DialogDescription>
              {game.attendeeCount} RSVP’d as playing · {pairs.length}{" "}
              {pairs.length === 1 ? "pair" : "pairs"}. Standby and unpaired players are listed
              separately.
            </DialogDescription>
            <div className="dance-print-controls">
              <button
                className="button"
                data-testid={`button-dance-print-${game.id}`}
                onClick={() => window.print()}
              >
                <Printer size={17} /> Print pair list
              </button>
              <p className="dance-caption">
                Print this date or choose Save as PDF in your browser’s print dialog. Share member
                names only with the club.
              </p>
            </div>
            <div className="dance-game-details">
              {game.events.length ? (
                game.events.map((event) => (
                  <div key={event.id}>
                    <strong>{event.title}</strong>
                    <p>
                      {new Date(event.date).toLocaleTimeString("en-US", {
                        timeZone: "America/Los_Angeles",
                        hour: "numeric",
                        minute: "2-digit",
                      })}{" "}
                      Pacific{event.location ? ` · ${event.location}` : ""}
                    </p>
                    {event.description && <p className="prewrap">{event.description}</p>}
                  </div>
                ))
              ) : (
                <p>
                  <strong>{game.title}</strong>
                  <br />
                  11:30 a.m. Pacific
                </p>
              )}
            </div>
            <h3 className="dance-screen-only">Playing pairs</h3>
            {pairs.length ? (
              <ol
                className="dance-pair-list dance-screen-only"
                data-testid={`list-dance-pairs-${game.id}`}
              >
                {pairs.map((pair) => (
                  <li key={pair.bookingId}>
                    <span>{names.get(pair.userId) || "Former participant"}</span>
                    <span className="dance-pair-plus">&amp;</span>
                    <span>{names.get(pair.partnerId!) || "Former participant"}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="dance-muted dance-screen-only">No pairs booked yet.</p>
            )}
            <table
              className="dance-print-only dance-print-table"
              data-testid={`table-dance-print-${game.id}`}
            >
              <colgroup>
                <col className="dance-print-number" />
                <col />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th colSpan={3}>Playing pairs · {displayDate(game.date)}</th>
                </tr>
                <tr>
                  <th scope="col">Pair</th>
                  <th scope="col">Player 1</th>
                  <th scope="col">Player 2</th>
                </tr>
              </thead>
              <tbody>
                {pairs.length ? (
                  pairs.map((pair, index) => (
                    <tr key={pair.bookingId}>
                      <th scope="row">{index + 1}</th>
                      <td>{names.get(pair.userId) || "Former participant"}</td>
                      <td>{names.get(pair.partnerId!) || "Former participant"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3}>No pairs booked for this date.</td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="dance-print-only dance-print-note">
              Pair numbers identify this list only; they are not table or seating assignments.
            </p>
            <h3>Standby</h3>
            <p data-testid={`text-dance-standby-${game.id}`}>
              {slots
                .filter((s) => s.status === "standby")
                .map((s) => names.get(s.userId) || "Former participant")
                .join(", ") || "No standby volunteers."}
            </p>
            <h3>Playing, without a partner</h3>
            <p>
              {data.attendance
                .filter(
                  (a) =>
                    a.gameId === game.id &&
                    a.attending &&
                    names.has(a.userId) &&
                    !slots.some(
                      (s) =>
                        s.userId === a.userId && (s.status === "booked" || s.status === "standby"),
                    ),
                )
                .map((a) => names.get(a.userId))
                .join(", ") || "No unpaired roster members."}
            </p>
            <p className="dance-caption">
              Names are shown only for members on the partner roster. The RSVP count includes
              members outside the roster.
            </p>
            <p className="dance-print-only dance-print-note">
              Member-only schedule snapshot. Bookings can change; check the member hub for the
              latest lineup.
            </p>
          </DialogContent>
        </Dialog>
      </td>
    </tr>
  );
}

function ScheduleForm({
  today,
  onSave,
}: {
  today: string;
  onSave: (input: DanceScheduleInput) => Promise<string>;
}) {
  const next = new Date(`${today}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + ((8 - next.getUTCDay()) % 7));
  const form = useForm<DanceScheduleInput>({
    defaultValues: {
      startDate: next.toISOString().slice(0, 10),
      weeks: 13,
      title: "Monday duplicate bridge",
    },
  });
  const [result, setResult] = useState(""),
    [error, setError] = useState("");
  return (
    <Form {...form}>
      <form
        className="dance-schedule-form"
        onSubmit={form.handleSubmit(async (input) => {
          setResult("");
          setError("");
          try {
            setResult(await onSave(input));
          } catch (e) {
            setError((e as Error).message);
          }
        })}
      >
        <label htmlFor="dance-start">
          First Monday
          <input
            id="dance-start"
            type="date"
            min={today}
            data-testid="input-dance-start"
            required
            {...form.register("startDate", { required: true })}
          />
        </label>
        <label htmlFor="dance-weeks">
          Number of weeks
          <input
            id="dance-weeks"
            type="number"
            min="1"
            max="52"
            data-testid="input-dance-weeks"
            required
            {...form.register("weeks", { required: true, valueAsNumber: true, min: 1, max: 52 })}
          />
        </label>
        <label htmlFor="dance-title">
          Game name
          <input
            id="dance-title"
            type="text"
            maxLength={120}
            data-testid="input-dance-title"
            required
            {...form.register("title", { required: true, maxLength: 120 })}
          />
        </label>
        <button
          className="button"
          type="submit"
          disabled={form.formState.isSubmitting}
          data-testid="button-dance-add-dates"
        >
          {form.formState.isSubmitting ? "Adding dates…" : "Add Monday dates"}
        </button>
        {Object.keys(form.formState.errors).length > 0 && (
          <p className="notice error" role="alert">
            Check the date, week count, and game name.
          </p>
        )}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <p className="notice success" role="status" data-testid="status-dance-schedule">
            {result}
          </p>
        )}
      </form>
    </Form>
  );
}
