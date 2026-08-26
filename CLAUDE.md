# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A multi-tenant SaaS ticketing + project/product-management platform. NestJS + Prisma + PostgreSQL backend (`backend/`), Vite + React + TypeScript frontend (`frontend/`). Despite `Info.txt` describing an aspirational Turborepo/React-Native monorepo, the actual repo is just these two apps plus `docker-compose.yml`.

## Running & building

The app runs via Docker Compose (three long-running containers: `ticketing-postgres-1` `:5432`, `ticketing-backend-1` `:3000`, `ticketing-frontend-1` `:5173`).

```bash
docker compose up          # start everything (backend hot-reloads via nest --watch, frontend via Vite)
docker compose logs backend --tail=20   # check backend compile/runtime output
```

Type-check without Docker (run from the app dir, not repo root):
```bash
cd backend  && npx tsc --noEmit -p tsconfig.json    # note: prisma/seed.ts has pre-existing errors — ignore them
cd frontend && npx tsc --noEmit -p tsconfig.app.json   # NOT -p tsconfig.json — see below
```

**Frontend type-check gotcha:** the frontend's root `tsconfig.json` is a solution file (`"files": []` + project references only). `tsc --noEmit -p tsconfig.json` therefore checks **nothing** and always "passes" — it does not follow references without `--build`. Always use `-p tsconfig.app.json` (or `npx tsc -b`). `tsconfig.app.json` sets `verbatimModuleSyntax: true`, so a type imported as a value (`import { SomeInterface }` instead of `import type`) compiles fine under the useless command but throws a runtime `SyntaxError: does not provide an export named …` in the browser — and since pages are imported eagerly in `App.tsx`, that white-screens the **entire** app, not just the offending page.

Other commands: backend `npm run build` (nest build), `npm run lint`, `npm test` (Jest; single test: `npx jest path/to/file.spec.ts`), `npm run test:e2e`. Frontend `npm run build` (`tsc -b && vite build`), `npm run lint`.

**Dev credentials:** login `admin` / `Admin@123` (tenant admin) or `superadmin` / `SuperAdmin@123`. DB: `postgres` / `password` / db `rbac_db`. Seeded agent users `agent1..agentN` also use `Admin@123`.

## Prisma / schema changes — READ THIS

Migrations are **not** driven by `prisma migrate dev`. The workflow is:

1. Edit `backend/prisma/schema.prisma`.
2. Add a hand-written SQL file under `backend/prisma/migrations/manual/` using idempotent DDL (`ADD COLUMN IF NOT EXISTS`, etc.).
3. Apply it to the running DB: `docker exec -i ticketing-postgres-1 psql -U postgres -d rbac_db < backend/prisma/migrations/manual/<file>.sql`.
4. Regenerate the client and restart so `@prisma/client` types update:
   ```bash
   cd backend && npx prisma generate                     # host copy (for local tsc)
   docker exec ticketing-backend-1 sh -c "cd /app && ./node_modules/.bin/prisma generate"
   docker restart ticketing-backend-1                    # startup also runs `prisma db push --accept-data-loss`
   ```

5. A new column reaches the API only if some service actually selects it. Several services return **hand-built projections** rather than the Prisma model — `customer-companies.service.ts` `list()` and `getOne()` both enumerate fields by hand, so a column added to the schema silently never arrives at the UI until you add it there too. Grep the domain's service for the sibling field before assuming it flows through.

**node_modules gotcha:** containers mount an anonymous `node_modules` volume, so `npm install` on the host does NOT reach the container. After adding a dependency: `docker exec ticketing-backend-1 sh -c "cd /app && npm install <pkg>"` then restart. Host `tsc` will report stale-Prisma-client errors until you run `prisma generate` on the host.

## Multi-tenancy & authorization (core model)

Everything is scoped to a **tenant** (`Client`). Auth is JWT (`@nestjs/passport` + `passport-jwt`); the token payload — and thus `req.user` — carries `{ id, username, roles, clientId, customerCompanyId }`. Services must scope every query by `req.user.clientId`; it is passed down as a `clientId` argument, not inferred globally.

Two user kinds share the `User` table:
- **Internal staff** (`clientId` set, `customerCompanyId` null) — Admins and agents (`Viewer` role).
- **External customer contacts** (`customerCompanyId` set) — belong to a `CustomerCompany` under a tenant, self-serve via `my-*` endpoints.

Roles are strings checked against route metadata:
- `SuperAdmin` — cross-tenant platform admin (global role, `clientId = null`).
- `Admin` — tenant admin.
- `Viewer` — internal agent/technician (ticket/task assignee).
- `CustomerAdmin` — a customer company's own admin (manages their team).

Backend guards in `backend/src/auth/`: `JwtAuthGuard` (authn), `RolesGuard` + `@Roles('Admin', ...)` decorator (role), `TenantGuard` (requires `clientId`), `StaffGuard`, `CustomerAdminGuard`. Frontend mirrors this: `ProtectedRoute` (logged-in) wraps `RoleGate` (role predicates like `isTenantAdmin`, `isCustomerAdmin` defined in `App.tsx`).

**The client screens are staff-*readable*, Admin-*writable*.** A named excess-hours approver may be a consultant with no other reason to open a client, so `/admin/customer-companies`, `/admin/clients/:id` and the per-product page are gated `isStaff`, and agents get a Clients nav item. Only four GETs on `api/customer-companies` are opened to `Viewer` (`:id`, `:id/product-contract`, `:id/purchased-products`, `:id/consultants`) — **every write stays `@Roles('Admin')`**, and `/assign` is still Admin-only. Non-admins get no Save/Renew/Assign/delete controls and a `readOnly` `ConsultantGrid`; the tile on the list page routes them to the client instead of opening the admin edit dialog.

- **What a client pays is withheld server-side, not just hidden in the UI.** `contractMonthlyCost` / `amcMonthlyCost` come back `null` for a non-Admin (`hideMoney` threaded through `getContract` / `listCompanyProducts` / `toView` / `contractView`). Hiding the field in a component would still ship the figure over the wire to every agent — keep the check in the service.

## Backend architecture

NestJS, one module per domain under `backend/src/<domain>/` (`tickets`, `projects`, `products`, `customer-companies`, `change-requests`, `kb`, `templates`, `sla`, `timesheet`, `client-visits`, …), each wired in `app.module.ts`. Standard shape: `*.module.ts`, `*.controller.ts` (routes + guards), `*.service.ts` (logic, takes `clientId`), `dto/*.ts` (class-validator DTOs — a global `ValidationPipe({ whitelist, forbidNonWhitelisted })` rejects unknown fields, so every accepted field needs a decorated DTO property).

- **Data access:** `PrismaService` (`prisma/`) extends `PrismaClient` using the **`@prisma/adapter-pg` driver adapter** over a `pg.Pool` — Prisma 7.
- **Uploads:** Multer to local disk under `backend/uploads/{logos,tickets,messages,kb,projects,change-requests}`, served statically at `/uploads`. **`main.ts` never raises the body-parser limit**, so Express's default ~100 KB JSON cap applies — image-sized payloads need a multipart route, not a data URL in a JSON body. (`Product.imageUrl` is a base64 data URL sent via `PATCH /api/products/:id` and will 413 on a large image; don't copy that pattern for new uploads.) Every logo route follows one template — `FileInterceptor('logo')` + `diskStorage` into `uploads/logos`, image-only `fileFilter`, 2 MB cap, store the relative path `/uploads/logos/<file>`, unlink the previous file on replace. See `my-client.controller.ts`, `clients.controller.ts`, `customer-companies.controller.ts`.
- **Cross-cutting services:** `mail/` (nodemailer + per-tenant `SmtpConfig`), `notifications/`, `lib/encryption.ts`. Some services run background sweeps via `setInterval` (e.g. product AMC/warranty expiry).

## Frontend architecture

Vite + React 19 + TypeScript, React Router 7. Routing and role predicates live in `App.tsx`.

- **Server state:** TanStack Query. **HTTP:** a single Axios instance `frontend/src/lib/api.ts` that injects the `accessToken` from `localStorage` and redirects to `/login` on any 401.
- **Auth:** `context/AuthContext.tsx`; base URL is hardcoded in `src/config.ts` (`http://localhost:3000`).
- **UI:** Tailwind CSS v4 + shadcn/ui (Radix primitives) in `components/ui/`, `lucide-react` icons, `sonner` toasts, `react-hook-form` + `zod`. Shared domain widgets (e.g. `ConsultantGrid`, `Layout`, `PermissionMatrix`) live directly in `components/`.
- Pages under `src/pages/`, grouped by area (`tickets/`, `projects/`, `clients/`, `change-requests/`, `super-admin/`, …).

**Radix `Select` caveat:** its portalled dropdown does not surface to the automation/browser tooling in this environment — prefer API/DB checks over clicking through a `Select` when verifying. Dropdown lists that must escape an `overflow-hidden` table (e.g. the agent type-ahead) are rendered via `createPortal` to `document.body` with fixed positioning.

**Radix `Select` + async options (bites every edit form):** a controlled `Select` whose `value` is not among its currently-mounted `SelectItem`s gets reset by Radix, which fires `onValueChange('')` and silently overwrites your state. On an edit form that hydrates from a fetched record, the saved value is set *before* the dependent option list has loaded (e.g. product/consultant lists gated on `enabled: !!customerCompanyId`), so the restored value is wiped ~100ms after it lands and the field renders as an empty dropdown. Guard every such handler — `ClientVisitFormPage` uses a `pick()` helper that ignores empty emissions, since a real user selection is never empty. Also give every `SelectValue` a `placeholder`: without one an unmatched value renders as a blank box with no hint anything is wrong. Same trap for any effect that "cleans up" a dependent field — gate it on the list having actually loaded (`isSuccess`), not on `length > 0`, or it clears the value while the list is still empty.

**`RadioGroup` is hand-rolled, not Radix** (`components/ui/radio-group.tsx`): its item calls `onValueChange(value)` on **every** click, including the option that is already selected. Any handler that writes on change must therefore ignore a no-op (`if (v === current) return;`) and must not be live before the true value has loaded — a radio whose `useState` default renders while the fetch is in flight will happily save that default. That is exactly how a client's `contractScope` silently flipped to `PRODUCT`.

**Don't key a hydrate effect on a query's object identity.** TanStack refetches on window focus and hands back a new object each time, so `useEffect(..., [record])` re-hydrates the form and discards whatever the user had typed. Key it on the saved *content* instead (`JSON.stringify` of the fields the form owns, as `ClientDetailPage` does), so a refetch with unchanged data is a no-op and a real server-side change still re-hydrates.

## Business domains

The platform bundles several modules (backend module ↔ frontend page area ↔ main models):

- **Tickets** (`tickets/`) — helpdesk tickets built from admin-designed **Templates** (`templates/`, custom fields in `Ticket.customFields`, keyed by `TemplateField.fieldKey`). **SLA** policies (`sla/`) set response/resolution targets. Picklist option lists (`picklists/`) feed dropdowns.
- **Products & AMC** (`products/`, `customer-companies/customer-products.service.ts`) — see the dedicated section below.
- **Customer companies** (`customer-companies/` ↔ `CustomerCompaniesPage` + `pages/clients/`) — external client organizations under a tenant, their contact users, per-product or one-shared-contract support agreements, and consultant routing. See the dedicated section below.
- **Projects** (`projects/`, `project-templates/`, `project-registers/`, `project-attachments/`, `resources/`, `timesheet/`) — full PM suite: WBS/tasks, sprints, milestones, risks/issues, resources & costs, timesheets, financials (budgets/invoices/expenses), Gantt (`frappe-gantt`).
- **Change requests** (`change-requests/`) — customer-facing change/charge requests with an approval flow and budget guard.
- **Client visits** (`client-visits/` ↔ `pages/client-visits/`, model `ClientVisit`, table still `ClientLog`) — logged client visits (`status` `PLANNED` | `VISITED` | `RESCHEDULE_REQUESTED`). See the dedicated section below.
- **Ticket tasks** (`tasks/` ↔ `TasksTab`, model `TicketTask`) — sub-tasks on a ticket, timed by their status trail. Note the module lives at `backend/src/tasks/`, **not** under `tickets/`. See the dedicated section below.
- **Ticket comments** (`comments/` ↔ `CommentsTab`, model `TicketComment`) — threads on a ticket and on its tasks. Also its own module, not under `tickets/`. See the dedicated section below.
- **Knowledge base** (`kb/`), **messaging** (`messaging/` — ticket message threads + channels), **notifications** (`notifications/` + `NotificationBell`), **approvals** (`approvals/`).

**`TicketMessage.isInternal` no longer means private.** The Chat thread (`channel = INTERNAL`, `isInternal = true`) is **shared with the client** — `listMessages` returns the whole thread to everyone who can see the ticket, and the client can post into it. The flag now only separates in-app chat from emailed replies. Don't reintroduce an agent-only filter on it, and don't treat a note written there as hidden.

## Ticket routing & lifecycle (important)

A ticket carries `productId` + `moduleId` + `consultantType` (`TECHNICAL` | `FUNCTIONAL`). On creation for a customer, it auto-assigns a consultant, most-specific-first (see `tickets.service.ts` → `customerProducts.resolveCustomerConsultant`):
1. A **CustomerConsultant** set for that exact product + module + track (client-specific override).
2. Same product+module, any track.
3. **Contract-level default consultant** for the matching track, then a track-less catch-all.
4. Falls back to the product/module's own consultant list only if `Product.autoAssign` is on.

Within any matching group the **primary** (`isPrimary`) agent wins. **Routing is never load-balanced:** a tier is skipped only when it has no consultant for that product/module/track, never because the candidate already holds open tickets — so the same product+module always lands on the same person. `products.service.ts` `firstInOrder()` just takes the head of the `isPrimary desc, sortOrder asc` list; the old `leastBusy()` open-ticket check was removed, don't reintroduce it. Customer-created tickets pass through an **approval gate**: `Ticket.approvalStatus` `NONE` (staff-created) / `PENDING` / `APPROVED` / `REJECTED` (reason required, emailed).

**A ticket holds at most one agent**, though assignment is still the `TicketTechnician` join table: `assignTechnicians` rejects a `userIds` longer than one. Every assign control must therefore be single-select and **replace** the current holder — a checkbox list that appends a second id makes reassignment impossible (that's what broke the ticket-list dropdown, now a `DropdownMenuRadioGroup` with an explicit "Unassigned" row). Who may reassign is gated by *visibility*, not an explicit rule: `StaffGuard` plus `findOne`, so Admins reassign anything and an agent reassigns a ticket they can see — which includes ones they merely hold a task or an approval on, not just ones assigned to them.

**A change of assignee notifies five audiences** (`notifyReassignment`): the incoming agent, the outgoing one, the requestor, the customer company's `CustomerAdmin`s and the tenant `Admin`s. Two guards matter when testing — the **actor is always dropped** (reassign as the only tenant Admin and the "provider admin" leg looks broken), and a re-PUT of the same agent is a no-op that sends nothing. Email goes out as **two** `sendMail` calls so customer and provider addresses never share a `To:`.

**Every status change is stamped, in two places.** `Ticket.statusChangedAt` carries the last move (the detail screen's "In this status since …"), and `TicketActivity` carries the trail. Stamp `statusChangedAt` at **every** door that writes `ticketStatus` — `update()`, `setResolution()`, acknowledge, reopen, approve, both rejections, the auto-close sweep and creation — or the line silently lies on whichever path forgot. Audit summaries quote the tenant's own picklist **labels** via `statusDisplay()`, not raw values; `statusLabel()` is the lower-cased variant for comparing against literals like `'resolved'` and must not be used in text a person reads.

**Resolution → acknowledgement → close, with two tenant-configurable windows** on `Client`, both edited on `OrganizationPage`: `ticketReopenWindowDays` (default 30) and `ticketAutoCloseDays` (default 3). `ticket-auto-close.service.ts` sweeps hourly on a plain `setInterval` (same pattern as `AmcExpiryService`, no external scheduler) and closes resolved tickets the client never acknowledged. Internal tickets — no `customerCompanyId` — are skipped and keep the direct staff close.

**Ticket detail screen — one green bar, above the tabs.** The resolved/acknowledged state and every action on it live in a single emerald banner in `TicketDetailPage`, rendered above the tab strip so it reads the same on every tab: row one is the status message with **Acknowledge & close** / **Reopen** / the info icon aligned right, row two is `Resolved … · Acknowledged … · Reopened N×` as small muted text (no pill of its own). `ResolutionTab` is the resolution editor only — it deliberately carries no status card and no acknowledge/reopen mutation, just the amber "came back" notice for an unresolved reopened ticket. `ReopenControl` owns the reopen affordance everywhere: button while the window is open, a "Create new ticket" link once it has closed, and the icon alone for staff on a customer's ticket (only the client may reopen theirs — same rule as `TicketsService.reopen`). Don't add a second green bar.

**The SLA countdown card is hidden once the ticket is resolved or closed** (`slaClockRunning` in `TicketDetailPage`). Read it off the live *status meaning*, not the `resolvedAt`/`closedDate` stamps: moving a ticket back out of Closed from the status dropdown leaves those in place, and a ticket that is Open again needs its clock back.

**The tab strip spans the full width.** `<Tabs>` wraps the whole area: `TabsList` first, then the `minmax(0,1fr)` + 18rem/20rem grid *inside* it holding the panels and the overview column. Putting the overview column beside the tab strip instead wraps History onto a second row, and a bare `1fr` takes its minimum from the strip's min-content and pushes the fixed column off-screen.

## Ticket time, tasks & the resolve gate

**`TicketWorklog` is the single source of *billable* ticket time, and it is logged by hand.** Every screen that quotes hours reads that one aggregate: the time list at the foot of the Tasks tab, the ticket header chip, and the customer's support-hours pool (`customerProducts.productSupportHours` → `ticketHours`). It is deliberately an **on-read aggregate, not a stored counter** — deleting a worklog corrects itself. Only `MONTHLY` pools also get a stored write, into `SupportHoursLedger.used` via `adjustLoggedHours`.

- **There is no Time tab** — Log time lives in the Tasks tab header (`WorklogSection`, rendered by `TasksTab`), so time sits with the work it was spent on. Every UI gate that used to redirect there now sends the agent to Tasks.
- **Do NOT mirror the client-visits `drawDown` pattern for ticket hours.** That one increments a stored `hoursUsed`/`contractHoursUsed` counter; adding a second stored counter for ticket time would double-count against the worklog aggregate. Client visits book **visits only** — the hours on a visit are deliberately never charged to the support-hour balance.
- `addWorklog` is the only door in; it and `deleteWorklog` funnel through private `writeWorklog` / `dropWorklog` so the allowance check, the ledger and the "hours low" alert can't drift. The allowance assertion sits in the *caller*, before anything is written.
- A worklog may optionally name the task the hours went on: `taskId` + denormalised `taskTitle`, validated to be a task **of that ticket**. The link is `onDelete: SetNull` — the hours were really spent and stay charged when the task goes, and the stored title keeps the entry saying what it was for.

**A task's clock is its status trail, and it books nothing.** Every real change to `TicketTask.status` writes a timestamped `TicketTaskStatusEvent` (server-stamped `at`, `fromStatus`/`toStatus`, denormalised `actorName`); `hoursSpent` is the sum of the stretches the task stood `IN_PROGRESS`, re-derived from the whole trail on every change so a correction fixes itself rather than drifting a counter. That figure is **audit only — never a `TicketWorklog`, never charged to the pool**; booking it would double-count against hand-logged time. There is deliberately no Start button, no `startedAt`/`endedAt`/`worklogId`, no `syncTaskWorklog` and no log-time control on a task — all were removed, don't reintroduce them.

- **Only the task's assignee or a tenant Admin may move its status** (`assertMayTrack`) — the trail is a timesheet. Any agent who can see the task may still edit its title, description, assignee and due date.
- **Only a real transition is recorded.** The status control emits on every pick, including the one already selected; `update()` ignores a re-pick rather than stamping a zero-length event.
- Stored `hoursSpent` counts **closed** stretches only. `list()` / `findOne()` add the open one when the task is `IN_PROGRESS`, so a running task shows live elapsed without the stored figure ever including a moving target. Sub-minute work rounds to zero hours.
- **A task row is click-to-open.** It carries a status `Select` and a delete button, so it is a `div role="button"` (a button cannot nest one) and those controls `stopPropagation`, or a quick status change also pops the dialog. `TicketTaskDialog` holds everything else — the editable fields, the description, the derived time, the status trail and the comments.

**Resolving or closing is gated twice**, at both doors (`update()` when the status label is resolved/closed, and `setResolution()`): `assertTimeLogged` (Σ worklog hours > 0 — so a task's own hours never satisfy it) and `assertTasksComplete` (no task outside `SETTLED_TASK_STATUSES`). Both sit behind `setResolution`'s `if (!wasResolved)` guard, so editing the notes on an already-resolved ticket is never blocked retroactively. Mirror each gate in the UI — the status dropdown and `ResolutionTab` both pre-check and redirect to the offending tab rather than letting the agent bounce off a 400.

- **`TicketTask.status` is `OPEN | IN_PROGRESS | DONE | CANCELLED`**, a plain String column; the list, `SETTLED_TASK_STATUSES` (`DONE` + `CANCELLED`) and the display labels live in `backend/src/tasks/task-status.ts`, imported by both `TasksService` and `TicketsService`. It is its own file precisely so neither import creates a cycle — `TicketsModule` does not import `TasksModule`, so the resolve gate queries `prisma.ticketTask` directly. The frontend mirrors it in `pages/tickets/detail/taskMeta.ts`.
- `CANCELLED` exists so an obsolete task can be settled without faking completion or deleting the audit trail; it keeps the time it had genuinely spent and drops out of `myTasks`.
- `findOne` enriches the ticket with `totalHoursSpent` and `openTaskCount`. Both ride on the ticket itself because the worklog and task endpoints are staff-only — a customer must still see the hours their contract is charged.

## Ticket comments

**One table serves both levels.** `TicketComment.taskId` null is a comment on the ticket; set, a comment on that task. `backend/src/comments/` is guarded `JwtAuthGuard + TenantGuard` **only — no `StaffGuard`**: everyone who can see the ticket can join its thread, customer contacts included, the same reach `messaging/messages.controller.ts` has. Visibility is delegated to `TicketsService.findOne`, which already knows the customer-side rules; the one extra rule the service adds is that **task comments are staff-only**, because tasks are — a customer-side viewer never sees them in `list()` and gets a `403` posting one.

- The **Comments** tab shows the ticket's own thread, then one group per task that has been commented on (empty groups are skipped, or they bury the ticket thread). `TaskComments` is the single thread component both that tab and `TicketTaskDialog` render, and both read one shared `['ticket-comments', ticketId]` cache entry filtered by `taskId` — so a count can never disagree with the list it labels.
- Posting logs a `COMMENT_ADDED` activity entry, so a comment shows up in History with its timestamp.

## Template field ordering (flat, not grouped)

`FIELD_CATALOG` (`backend/src/tickets/field-catalog.ts`) tags every field with a `group` — `ticket_info` | `ticket_detail` | `root_cause`. **That group is a label, not an ordering key.**

The Create Ticket form and the Template Designer's live preview render fields strictly by `TemplateField.sortOrder`, using `groupFieldRuns()` (`frontend/src/pages/tickets/ticketHelpers.ts`) to split the ordered list into *contiguous runs* of the same group and emit one heading per run. Both screens import `FIELD_GROUP_LABELS` from there — don't reintroduce a local `GROUP_ORDER` constant.

- Why: the designer's field list is flat with up/down arrows that save `sortOrder: 0,1,2…`, but both renderers used to re-bucket into a fixed Ticket Info → Ticket Detail → Root Cause sequence. Cross-group reordering was silently discarded (dragging Subject above Priority did nothing, because Subject is `ticket_detail` and Priority is `ticket_info`).
- **Convention: Subject and Description lead the form, then Priority.** They sit at the front of `FIELD_CATALOG` (so they head the "Add system field" list) and of every seeded template.
- Interleaving groups now repeats a heading — that's honest feedback about what the admin built, but keep seeded/default orders **group-contiguous**. `attachments` is a `ticket_detail` field, so it sits with the Subject/Description block rather than at the bottom where it would split that heading in two.
- Existing rows were corrected by `prisma/migrations/manual/reorder_subject_description_first.sql` (idempotent; re-running reports `UPDATE 0`).

## Products / consultants / coverage model (the area with the most churn)

- **`Product`** → has **`ProductModule`**s (`ProductModule.tracks[]`, default `[TECHNICAL, FUNCTIONAL]`) or, when unsplit, product-level tracks. Each module/track has an ordered consultant list (**`ModuleConsultant`** / **`ProductConsultant`**, `isPrimary`, `sortOrder`). Grid columns everywhere are **Technical / Functional / Others**; custom/other tracks map to the *Others* column (stored as `track = null`).
- **`CustomerCompanyProduct`** — a customer's purchased product on ONE coverage timeline chosen by radio: **Warranty (free) → AMC (paid)**. `amcType` `FREE` = under warranty, `PAID` = under AMC; `freeAmc*` fields hold the warranty pool, `paidAmc*` the AMC pool. Terms are a date range + support hours + visits (+ contract amount for AMC). `amc-expiry.service.ts` runs periodic sweeps for expiry/alerts.
- **`CustomerCompany.contractScope`** `PRODUCT` (per-product AMC) vs `CUSTOMER` (one shared pooled contract; `contractCoverageType` `WARRANTY` | `AMC`, shared dates/hours/visits). The client screen has a Per-product / One-customer-contract radio, and the customer-contract form carries the same Warranty/AMC radio as the per-product screens.
- **Warranty is free, so it never carries a contract amount.** All three coverage screens (`ClientDetailPage`, `ClientProductPage`, `ClientAssignProductPage`) hide the Contract amount / Monthly cost field unless coverage is `AMC`, and `setContract` / `renewContract` force `contractMonthlyCost` to `null` for `WARRANTY` regardless of what the caller sends — so switching AMC → warranty clears a stale amount.
- **`CustomerConsultant`** — the client's own consultant assignments (per product+module+track, or contract-level with `productId=null,moduleId=null`), with `isPrimary`. The contract-level rows are the client's **Default consultants**: one shared set that applies whatever the `contractScope` is, so `ClientDetailPage` renders that grid in **both** modes (it used to be gated to `CUSTOMER`). Per-product overrides stay on `ClientProductPage`. These are **independent** of the product's `ModuleConsultant`s: assigning a product does NOT auto-copy the product's consultants (there is deliberately no `seedConsultantsFromProduct` — it was removed); removing a product deletes its `CustomerConsultant`s so a re-add starts clean.
- **Switching `contractScope` is guarded, and confirming the dialog is what applies it.** On `ClientDetailPage` the Contract type radio stays disabled until the saved contract has loaded, ignores a re-pick of the current value, and confirms either direction in a dialog. Confirming PUTs `{scope}` on its own, in **both** directions — no second **Save contract** press. That is safe because `setContract` is a **partial** update: a field the payload omits is left as it is, and only an explicit `null` clears it (it used to null `contractStart`/`contractEnd`/`contractVisits` on any CUSTOMER write, and to demand a support-hours pool a fresh client didn't have). Two consequences: the support-hours pool is re-resolved only when `hoursUnlimited`/`hours` is actually present, and `saveCustomer` must send `null` — never `undefined` — for a box the admin emptied, or the clear is silently dropped. `productIds` was already opt-in; an absent list leaves the covered products alone, while an empty one still means "covers nothing".
- **The customer-contract screen mirrors the per-product one.** In `CUSTOMER` scope `ClientDetailPage` shows Products covered (with its own **Assign a product** button) full-width, then read-only **Coverage** left and editable **Terms** right; per-product it is `ClientProductPage`. Both render the same three meters through `components/CoverageMeter.tsx` — coverage term, support hours, site visits — whose `pct` is the share **consumed** (`contract.period.pct` is percent elapsed, pass it straight through). `ClientAssignProductPage` hides its per-product terms under `CUSTOMER` scope and posts only `productId`, since those pools are never read there.
- **How a support-hours pool is *counted* is configured per client, and applies to both scopes.** Six settings, mirrored field-for-field between `CustomerCompany` (`contract*`) and `CustomerCompanyProduct` (`amc*`): `…HoursPeriod` `FULL_AMC | MONTHLY`, `…CarryForward`, `…AllowTicketsAfterHours`, `…AllowExcess`, `…ExcessApproval`, `…ExcessApproverId`. `resolvePoolConfig()` collapses that pair into one shape, so service code never branches on scope. The whole block is one shared UI widget, `components/SupportHoursConfig.tsx` — edit it, not per-screen copies, and it renders last on every coverage screen (after AMC / support hours / site visits / terms).
- **`MONTHLY` pools keep a per-calendar-month ledger** (`SupportHoursLedger`, unique on `[scope, ownerId, periodLabel]`, holding `allocated` / `carriedIn` / `used`). The month's cap is `allocated + carriedIn`, and `carriedIn` is only non-zero when carry-forward is on. `rollForwardLedgers()` opens the new month's bucket, called from the `amc-expiry.service.ts` sweep. `FULL_AMC` writes no ledger at all — `adjustLoggedHours` no-ops for it, and usage stays a pure on-read aggregate.
- **`assertHoursWithinAllowance` is the one gate on over-cap logging** — call it *before* writing anything. It refuses once the pool is exhausted unless `allowExcess`; with `excessApproval` on it defers to `assertExcessApproved` (below). Unlimited and unmapped pools are a no-op.
- **`SupportHoursExcessRequest` is a permission, not a time entry.** Hitting the cap on an approval-gated pool raises a PENDING row and *still refuses* the log; APPROVED unlocks over-cap logging so the consultant enters their hours normally; REJECTED keeps it blocked and returns the reason. **Approving books nothing** — deliberately, so nobody's time is recorded without them seeing the final figure. There is one live row per pool per period, so a retry names where the decision sits instead of spamming the approver with a second request, and a REJECTED row is not auto-replaced.
- `periodLabel` is the calendar month for `MONTHLY` pools — a new month restores the allowance and must be re-approved rather than riding January's sign-off — and the **`'ALL'` sentinel, never null**, for `FULL_AMC`: Postgres treats NULLs as distinct, so a nullable column in that unique index would stop catching duplicates.
- **Who may decide is checked in the service, not the route.** Only the named `excessApproverId` or a tenant Admin; the endpoints are `StaffGuard` because the client screens are staff-readable, so route-level guarding alone would let any agent sign off someone else's approval. Both the request and the decision notify with a `link` to the pool's own screen — an approver who is a consultant would otherwise have no way to find the client. `ExcessHoursApprovals` renders below Products on each client screen (collapsed unless something is pending, and absent entirely when there is nothing), and `MyExcessApprovals` banners the Clients list with everything awaiting *this* user.
- **`assertMayRaiseTicket` is its sibling on the other side**: an exhausted pool bars the *client* from raising more tickets, but only when `allowTicketsAfterHours` is off for whichever pool governs. Defaults to on, so support does not stop the moment the hours run out. It fires only on the customer self-service path in `create()` — **staff-raised tickets are never gated**, and neither are unlimited or unmapped pools.
- **Consultant dropdowns on client screens are scoped to the product's own agents**, not all staff: `ClientProductPage` and `ClientAssignProductPage` build the `ConsultantGrid` `staff` list from the product's `modules[].consultants` + product-level `consultants` (assigned in the Products screen), rather than querying `/api/users`. Grid cells start empty — the admin picks from that narrowed list.

## Client screen (`CustomerCompaniesPage`)

The client list at `/admin/customer-companies` is a **table**, not a tile grid: a search box over name+code above a `components/ui/table` listing with one column per detail — client name, code, contact person, email, phone, contract scope, tickets, status, then **Actions**. Nullable text cells fall back to an em dash. Deliberately **no logo and no contacts `n/max` column** (a client's headcount lives in the dialog's People list): the wide text cells cap themselves (`block max-w-[…] truncate` + a `title`) and the narrow ones are `w-px`, so the table fits without a horizontal scroll — don't add columns back without re-checking that. **The row itself is inert** — every route out of the page is an explicit icon button, so the row is a plain `<TableRow>` and needs no `role="button"` / `stopPropagation` scaffolding (the old tile did).

- **Three row actions, gated by role:** `Boxes` → `/admin/clients/:id` (Products & consultants) for **all staff** — a consultant is on this screen only to decide an excess-hours request, so it is the one action they get; `Pencil` → the edit dialog and `Trash2` → delete, both **Admin only**.
- **Everything about a client lives in that one dialog**: identity (name, code, max contacts), contact email / contact person / contact number, the logo picker, a **Products & consultants** button routing to `/admin/clients/:id`, and below it a **read-only People list** (a customer's own `CustomerAdmin` manages their users; staff only seed the first admin at creation). There is deliberately no People tab — don't reintroduce one. The dialog stays the only place a client is edited.
- **Logo:** `CustomerCompany.logoUrl` via `POST`/`DELETE api/customer-companies/:id/logo` (multipart — see the Uploads note above). Rendered by `components/CompanyLogo.tsx`, which is `ProductIcon` with a `Building2` fallback and an `assetUrl()` call, since the value is a server path and not a data URL. On **create** there is no id yet, so the picked `File` is held in state and uploaded straight after the company POST returns.
- **`agreedSupportHours` / `supportPeriod*` are dormant data.** They still exist on the model and the DTOs, but `support-hours.service.ts` deliberately does **not** read them: they belong to neither coverage scope, so reporting them showed a customer a pool that governs nothing. Coverage owns this instead — `GET :id/support-usage` answers from the shared contract, and per-product figures come from `CustomerProductsService.productSupportHours`. (`supportAlertThresholdPct` is still live, as the alert threshold.) Don't restore any of them to the form or to the usage maths.

## Client visits & contract draw-down

`ClientVisit` records a client visit against a `CustomerCompany` and a consultant. `api/client-visits` is **Admin-only** (`@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)` + `@Roles('Admin')`), so `Layout.tsx` filters the Client Visits nav item out for non-admin staff — otherwise agents would follow a link that just 403s.

- **Prisma model vs. table:** the model is `ClientVisit` but carries `@@map("ClientLog")`, and `visitNumber` / `Client.clientVisitSequence` carry `@map("logNumber")` / `@map("clientLogSequence")`. The rename was code-only — the physical table and columns are still the original ones, so no data moved. Don't "fix" the mapping without an `ALTER TABLE`.
- Numbering: `CL-000001`, from `Client.clientVisitSequence` (same pattern as `ticketSequence` / `crSequence`). The prefix is still `CL-` so existing numbers stay valid.
- `consultantName` and `productName` are denormalised at write time so the list needs no join.
- **Creating/editing a visit is a full page** (`/client-visits/new`, `/client-visits/:id/edit` → `ClientVisitFormPage`), not a dialog. Purpose and Description lead the form, then the grid of date / client / product / consultant / hours / status / ticket.
- **There is no visit type and no project link.** Every record is a visit, so the old `visitType` (`ON_SITE`/`REMOTE`/`PHONE`) and the `projectId` field were dropped from the schema, DTOs, filters and UI by `prisma/migrations/manual/client_visit_rename.sql`. The customer-company field is labelled **Client** throughout this module.
- **Statuses are `PLANNED` | `VISITED` | `RESCHEDULE_REQUESTED`** (`VISIT_STATUSES` in both `dto/client-visit.dto.ts` and `pages/client-visits/clientVisitsMeta.ts`). `VISITED` replaced `COMPLETED` as the one status that draws down the contract.
- **Rescheduling is two states, not one.** A consultant reports `RESCHEDULE_REQUESTED` (orange badge, admins notified "needs a new date"); an admin then supplies a date, which flips the row back to `PLANNED` and increments `ClientVisit.rescheduleCount`. The status says where the visit is *now*; `rescheduleCount` carries the history as a separate orange "Rescheduled" badge, so a re-dated visit reads as the normal upcoming visit it is. Consultants cannot set the date at all (`CONSULTANT_EDITABLE` = hours/status/notes) — the admin row action is **Set new date** while a request is open and **Edit visit** otherwise.
- **A visit that hasn't happened yet can't be booked in the past** (`assertScheduleDate`): `PLANNED`/`RESCHEDULE_REQUESTED` must be today or later, while `VISITED` may be back-dated since it records what already happened. Re-dating a `RESCHEDULE_REQUESTED` visit to the date it already has is rejected.
- **A `VISITED` row draws down one pool, never two** (`resolvePool` + `drawDown` in `client-visits.service.ts`, gated by the `DEDUCTING_STATUS` constant): the named product's own AMC/warranty pool (`CustomerCompanyProduct.hoursUsed/visitsUsed` — what the Products screens show) when the customer is on `contractScope = PRODUCT`, otherwise the shared customer contract (`contractHoursUsed`/`contractVisitsUsed`). `contractDeducted` records whether *this row's* draw-down is applied and `deductedCpId` records **where** it landed, so an edit reverses exactly what it applied — even if the product, customer, hours or contract scope changed since — and a status flip or delete reverses exactly once. Any change to hours, status, customer or product must keep that invariant.
- **The form's choices are scoped to the chosen client.** Product comes from `GET :id/purchased-products` (what the customer actually owns) and Consultant from `GET :id/consultants` (that customer's own `CustomerConsultant` rows, deduped by user, narrowed to the picked product plus contract-level rows with `productId=null`). Tickets narrow to the client too. Changing the client resets the other three. The backend enforces the product half: `create`/`update` reject a `productId` the customer doesn't own.
- **`ClientVisitsPanel`** (`pages/client-visits/`) takes a `filter` of `customerCompanyId` / `productId` / `ticketId` (all supported as `GET api/client-visits` query params). It is mounted **only** on the tenant-admin-only **Client Visits** tab of `TicketDetailPage` — it was deliberately removed from `ClientDetailPage` and `ClientProductPage`. Its "Log a visit" button deep-links to `/client-visits/new?…` with those ids pre-filled, and "View all" carries them to the list page as a clearable context filter. The panel hits the Admin-only API — only render it behind an admin check.

## API conventions

- All routes are prefixed `api/…` (`main.ts` has no global prefix — controllers include it). Staff/admin endpoints live under domain prefixes (`api/products`, `api/customer-companies`, `api/tickets`, …).
- **Customer self-service** endpoints use `my-*` prefixes (`api/my-company`, `api/my-client`, `api/my-team`, `api/my-tasks`, `api/my-change-requests`) and are scoped to `req.user.customerCompanyId`.
- Cross-tenant platform admin under `api/super-admin/*`.

## Git & conventions

- Work happens on release branches (currently `Release_1.0.0`); `main` is the default PR target. Branch before committing if on `main`. Commit only when asked.
- Commit style: short imperative summary of the change set (see `git log`).
- Never fabricate feature results by hand-editing the DB — verify through the real UI/API and clean up test data afterward.
