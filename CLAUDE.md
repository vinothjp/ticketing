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

## Business domains

The platform bundles several modules (backend module ↔ frontend page area ↔ main models):

- **Tickets** (`tickets/`) — helpdesk tickets built from admin-designed **Templates** (`templates/`, custom fields in `Ticket.customFields`, keyed by `TemplateField.fieldKey`). **SLA** policies (`sla/`) set response/resolution targets. Picklist option lists (`picklists/`) feed dropdowns.
- **Products & AMC** (`products/`, `customer-companies/customer-products.service.ts`) — see the dedicated section below.
- **Customer companies** (`customer-companies/` ↔ `CustomerCompaniesPage` + `pages/clients/`) — external client organizations under a tenant, their contact users, per-product or one-shared-contract support agreements, and consultant routing. See the dedicated section below.
- **Projects** (`projects/`, `project-templates/`, `project-registers/`, `project-attachments/`, `resources/`, `timesheet/`) — full PM suite: WBS/tasks, sprints, milestones, risks/issues, resources & costs, timesheets, financials (budgets/invoices/expenses), Gantt (`frappe-gantt`).
- **Change requests** (`change-requests/`) — customer-facing change/charge requests with an approval flow and budget guard.
- **Client visits** (`client-visits/` ↔ `pages/client-visits/`, model `ClientVisit`, table still `ClientLog`) — logged client visits (`status` `PLANNED` | `VISITED` | `RESCHEDULED`). See the dedicated section below.
- **Knowledge base** (`kb/`), **messaging** (`messaging/` — ticket message threads + channels), **notifications** (`notifications/` + `NotificationBell`), **approvals** (`approvals/`).

## Ticket routing & lifecycle (important)

A ticket carries `productId` + `moduleId` + `consultantType` (`TECHNICAL` | `FUNCTIONAL`). On creation for a customer, it auto-assigns a consultant, most-specific-first (see `tickets.service.ts` → `customerProducts.resolveCustomerConsultant`):
1. A **CustomerConsultant** set for that exact product + module + track (client-specific override).
2. Same product+module, any track.
3. **Contract-level default consultant** for the matching track, then a track-less catch-all.
4. Falls back to the product/module's own consultant list only if `Product.autoAssign` is on.

Within any matching group the **primary** (`isPrimary`) agent wins. Customer-created tickets pass through an **approval gate**: `Ticket.approvalStatus` `NONE` (staff-created) / `PENDING` / `APPROVED` / `REJECTED` (reason required, emailed).

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
- **Consultant dropdowns on client screens are scoped to the product's own agents**, not all staff: `ClientProductPage` and `ClientAssignProductPage` build the `ConsultantGrid` `staff` list from the product's `modules[].consultants` + product-level `consultants` (assigned in the Products screen), rather than querying `/api/users`. Grid cells start empty — the admin picks from that narrowed list.

## Client screen (`CustomerCompaniesPage`)

The client list at `/admin/customer-companies` mirrors the Products screen: a search box over name+code and a `grid-cols-2 sm:3 lg:4` of `rounded-xl` tiles showing `CompanyLogo` + name + code + status + counts. **The tile body opens the edit dialog** and a trash icon is the only other control — so the tile is a `div role="button"`, not a `<button>` (a button cannot nest one).

- **Everything about a client lives in that one dialog**: identity (name, code, max contacts), contact email / contact person / contact number, the logo picker, a **read-only People list** (a customer's own `CustomerAdmin` manages their users; staff only seed the first admin at creation), and a **Products & consultants** button that routes to `/admin/clients/:id`. There is deliberately no People tab and no row-level Products button — don't reintroduce either.
- **Logo:** `CustomerCompany.logoUrl` via `POST`/`DELETE api/customer-companies/:id/logo` (multipart — see the Uploads note above). Rendered by `components/CompanyLogo.tsx`, which is `ProductIcon` with a `Building2` fallback and an `assetUrl()` call, since the value is a server path and not a data URL. On **create** there is no id yet, so the picked `File` is held in state and uploaded straight after the company POST returns.
- **The support-hours pool is DB- and API-only.** `agreedSupportHours` / `supportPeriod*` / `supportAlertThresholdPct` still exist on the model, the DTOs and `GET :id/support-usage`, and `support-hours.service.ts` still reads them — only the form controls were removed, because per-product warranty/AMC coverage now owns this. Don't "restore" the fields to the form.

## Client visits & contract draw-down

`ClientVisit` records a client visit against a `CustomerCompany` and a consultant. `api/client-visits` is **Admin-only** (`@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)` + `@Roles('Admin')`), so `Layout.tsx` filters the Client Visits nav item out for non-admin staff — otherwise agents would follow a link that just 403s.

- **Prisma model vs. table:** the model is `ClientVisit` but carries `@@map("ClientLog")`, and `visitNumber` / `Client.clientVisitSequence` carry `@map("logNumber")` / `@map("clientLogSequence")`. The rename was code-only — the physical table and columns are still the original ones, so no data moved. Don't "fix" the mapping without an `ALTER TABLE`.
- Numbering: `CL-000001`, from `Client.clientVisitSequence` (same pattern as `ticketSequence` / `crSequence`). The prefix is still `CL-` so existing numbers stay valid.
- `consultantName` and `productName` are denormalised at write time so the list needs no join.
- **Creating/editing a visit is a full page** (`/client-visits/new`, `/client-visits/:id/edit` → `ClientVisitFormPage`), not a dialog. Purpose and Description lead the form, then the grid of date / client / product / consultant / hours / status / ticket.
- **There is no visit type and no project link.** Every record is a visit, so the old `visitType` (`ON_SITE`/`REMOTE`/`PHONE`) and the `projectId` field were dropped from the schema, DTOs, filters and UI by `prisma/migrations/manual/client_visit_rename.sql`. The customer-company field is labelled **Client** throughout this module.
- **Statuses are `PLANNED` | `VISITED` | `RESCHEDULED`** (`VISIT_STATUSES` in both `dto/client-visit.dto.ts` and `pages/client-visits/clientVisitsMeta.ts`). `VISITED` replaced `COMPLETED` as the one status that draws down the contract; `RESCHEDULED` replaced `CANCELLED`.
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
