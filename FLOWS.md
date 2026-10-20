# Main flows and calendar layout checks

## Existing flows to preserve
- Home: exactly About and Login buttons; slideshow advances and respects reduced motion.
- About: About placeholder, Home and Login return correctly.
- Login: invalid credentials show an error; member/admin preview login opens the calendar.
- Calendar: previous/next month and Today work; empty months have a clear state; past dates remain readable.
- Dance card: select a date, see all pairs, select an available partner, register both, or register solo.
- Cancellation: confirm cancellation; own entry is removed and partner remains looking.
- Admin: same calendar, Add date and Add member dialogs; close buttons and validation work.
- Log out invalidates session; reload requires login.

## Requested layout improvement
- Desktop: readable month navigation, distinct playing/selected/today states, pair counts and own registration both visible.
- Dance card: bordered panel, clear selected-date header, registration visually separated from pair list.
- At 640px and below: show the month's playing dates as a list instead of seven compressed columns, with readable times, pair counts and registration status.
- Mobile selection scrolls to the matching dance card; desktop keeps the side-by-side layout.
- Resize desktop to mobile and back while signed in; retain selected month and date.
- Check 375px, 768px, 1440px, and a short desktop viewport for overflow.
- Recheck registration/cancellation after deployment through the hosted API.
- Do not change home, about, authentication, database, or partnership rules.

## Hosting package checks
- Preserve all public source bytes from the reviewed calendar version.
- Deliver source, not the preview deployment folder or database.
- Production startup serves the same application with preview access disabled.
- Missing database fails clearly; initialization remains an explicit operator step.
- Real production-mode login and empty-calendar API work through app.cjs.
- Test Passenger's startup contract with a simulation; label actual host integration unverified.
- Extract the ZIP and rerun API and startup tests from its contents.
