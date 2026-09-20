# Printable pair lists

## Acceptance inventory

- Each upcoming and historical date exposes Print pair list inside View pairs.
- The button calls browser printing without creating a public member-data URL.
- Print media contains only the selected date's club heading, game details,
  counts, numbered pair table, standby and unpaired roster names.
- Empty dates show an explicit no-pairs message.
- Each partnership appears once, matching the on-screen lineup.
- Printing has no navigation, booking buttons, overlays or modal height limit.
- White paper and black text apply in both light and dark site themes.
- Long lists repeat the date and column headers; rows do not split across pages.
- Names wrap instead of clipping, and pair numbers are not seating assignments.
- Screen layout is checked at 1440px and 375px, including the new print control.
- Closing or cancelling printing leaves the schedule usable and unchanged.

## Privacy and limits

Printing uses the member's browser and the already-authorized date lineup.
No database change, email, export upload or public sharing is performed.
The browser controls printer selection, Save as PDF availability, page size
and its own optional headers/footers. Browser or embedding restrictions can
disable the system print dialog; use the standalone site if an embed blocks it.

## Verification

Verified September 16, 2026 against synthetic accounts on the isolated test
site. Type checking, production build and all 42 existing backend/lifecycle
tests passed. The print button's call to browser printing was exercised with a
test spy; Chromium print-media output was rendered to Letter and A4 PDFs.
Physical printer hardware and the operating system's native dialog were not
automated.

Inspected a one-pair page and the second page of a 100-pair fixture. All 200
synthetic names appeared once across six pages, with the selected date and
column headings repeated on every page. Empty-date output contained an explicit
no-pairs message. Historical dates exposed the same print control.

The print stylesheet removed navigation, controls and the dialog scroll cap.
Dark-mode output was black text on white. Screen layouts were checked at 1440px
and 375px; no page-level horizontal overflow or JavaScript errors were found.
Returning from print media and closing the dialog left the schedule usable.
Test printouts remain private QA files, not real club pair lists.
