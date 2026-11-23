// @title: Backoffice MCP Plan
import { Page, Section, P, Id, Src, Ref, BeforeAfter, Table, Card, Grid, Callout, Steps, Figure, Changes, Chip } from '@/kit'
import './readable-theme.css'
import { McpArchitecture } from './diagrams/mcp-architecture'
import { McpAuthSequence } from './diagrams/mcp-auth-sequence'
import { StaffRolesSchema } from './diagrams/staff-roles-schema'

const meta = { repo: 'act-security/act', sha: '5f3d8855f8e30c878c6610e50fc5a25e0f63ab17' }
const TERRAPLAIN_DOC = 'https://github.com/act-security/terraplane/blob/main/docs/mcp.md'

export default function App() {
  return (
    <Page
      meta={meta}
      eyebrow="Plan · 2026-11-23"
      title="Backoffice MCP"
      thesis="Staff run backoffice operations from Claude Code through a /mcp route on backoffice-service. Each tool runs an existing procedure as the signed-in staff member, so every check and audit row stays as it is."
      pills={['backoffice-service /mcp', 'MCP SDK v2', 'OAuth 2.1', 'staff roles', 'Podium', '6 PRs']}
    >
      <Section group="Why" id="why" title="Why" takeaway="Backoffice operations are UI clicks that no agent can make.">
        <P>
          Staff flip feature flags, re-run tenant RMPO DAG runs and suspend tenants through the backoffice UI.
          Claude Code and Podium can't call any of it, so every operation stays a manual, per-person routine.
        </P>
        <P>
          The operations, checks and audit already exist in backoffice-service. What's missing is one standard way for an
          agent to call them, under the staff member's own identity.
        </P>
      </Section>

      <Section group="Why" id="before-after" title="Before and after" takeaway="Same operation, same checks, same audit row; one request instead of clicks.">
        <BeforeAfter
          example="Re-run the RMPO DAG for one tenant"
          rows={[
            { aspect: 'How it starts', before: 'Open backoffice, find the tenant, click the trigger', after: 'Ask Claude Code to re-run the tenant\'s RMPO DAG' },
            { aspect: 'Finding the tenant', before: 'Search the tenant list by hand', after: <>The agent calls <Id>bo_tenants_list</Id> and passes the ID</> },
            { aspect: 'Confirming the write', before: 'The click is the confirmation', after: <>The client prompts first (<Id>destructiveHint</Id>)</> },
            { aspect: 'Checking it ran', before: 'Open the pipeline status panel', after: 'The result returns the tenant name and the DAG run link' },
            { aspect: 'Checks', hint: 'staff identity, DAG schedule exists', before: 'backoffice-service', after: 'backoffice-service', same: true },
            { aspect: 'Audit row', before: 'Actor = the staff member', after: <>Actor = the staff member, tagged <Id>via: mcp</Id> + intent</> },
          ]}
          result={{ before: 'Manual clicks in the UI', after: 'One request from Claude Code or Podium' }}
          caption="The MCP changes who presses the button, not the rules behind it."
        />
      </Section>

      <Section group="Design" id="architecture" title="Architecture" takeaway="A route inside backoffice-service, built like Terraplain's MCP server.">
        <Figure caption="Highlighted: the only new piece. The procedures, audit log, PostHog and RMPO DAG calls are unchanged.">
          <McpArchitecture />
        </Figure>
        <P>
          This follows <Ref href={TERRAPLAIN_DOC}>Terraplain's MCP server</Ref>: the official SDK v2
          (<Id>@modelcontextprotocol/server</Id>), stateless, a fresh server per request for the token's user, and tools
          that call the service's own API in-process as that user.
        </P>
        <Callout title="Why not a separate app on FastMCP">
          A separate app needs a network hop, its own pass through Cloudflare Access and a forwarded token. In-process,
          the procedures run exactly as they do for the UI. Stateless SDK v2 also avoids FastMCP's in-memory session loss.
        </Callout>
      </Section>

      <Section group="Design" id="today" title="Starting point" takeaway="Every operation, check and audit row already exists; only the door is missing.">
        <Table
          columns={['Piece', 'Today', 'Where']}
          rows={[
            ['Staff procedures', '177 protectedProcedure + 28 demoGuardedProcedure', <Src path="apps/backoffice-service/src/adapters/trpc/app-router.ts" />],
            ['Staff check', <>Auth0 token from the session cookie; <Id>isActUser</Id> required</>, <Src path="apps/backoffice-service/src/adapters/auth/tokenVerifier.ts" />],
            ['Edge check', 'Cloudflare Access assertion on every staff call', <Src path="apps/backoffice-service/src/adapters/cloudflare/access-assertion.verifier.ts" />],
            ['Audit', 'Every mutation, actor = the staff member', <Src path="apps/backoffice-service/src/adapters/trpc/router.ts" />],
            ['Customer MCP', 'FastMCP + Auth0 proxy, stateful sessions', <Src path="apps/mcp-server/README.md" />],
          ]}
        />
      </Section>

      <Section group="Design" id="security" title="Security and auth" takeaway="A token good only for /mcp, scoped per tool, and every call audited with its intent.">
        <Figure caption="Discovery, sign-in and one call. Refusals come back as 401, 403 insufficient_scope or a typed error code.">
          <McpAuthSequence />
        </Figure>
        <Table
          columns={['Concern', 'Design']}
          rows={[
            ['Who signs in', <>Act staff, the same identity as the backoffice UI (<Id>isActUser</Id>)</>],
            ['Token', 'OAuth 2.1 with PKCE. Short-lived access token bound to /mcp; rotating refresh tokens. tRPC routes reject it, and /mcp accepts nothing else'],
            ['Client registration', 'Client ID Metadata Documents for Claude Code and claude.ai; a confidential client for the Podium gateway. No open dynamic registration'],
            ['Cloudflare Access', 'A new backoffice-mcp Access app, like terraplane-mcp, bypasses only /mcp and the discovery documents, on dev and prod. The backoffice UI stays behind Okta'],
            ['Edge check in-process', 'The /mcp token check stands in for the Access assertion, passed in context, never a header a client could send'],
            ['Authorization', 'The token\'s scopes (bo:read, bo:write) cap what the client may do; the person\'s roles, read live from Postgres, cap what they may do. A tool beyond the grant answers 403 insufficient_scope. See Staff roles'],
            ['Audit', 'Every MCP call, reads included (today only mutations are audited): via mcp, OAuth client, tool and the model\'s stated intent'],
            ['Untrusted text', 'Tenant names, audit details and other text people wrote come back in untrusted_content fields'],
          ]}
        />
        <Callout title="Authorization server: Auth0, no new service">
          Auth0 already holds staff identity, and <Ref href="https://auth0.com/blog/auth0-auth-for-mcp-servers-generally-available/">Auth for MCP</Ref> has
          been GA since 2026-05-06. <Ref href="https://auth0.com/docs/get-started/auth0-overview/create-applications/register-applications-with-cimd">Manual CIMD registration</Ref> covers
          Claude Code and claude.ai; the Resource Parameter Compatibility Profile ties requests to /mcp. Open: these are
          tenant-wide settings, shared with the customer mcp-server, and dynamic CIMD is Early Access, so register clients by hand.
        </Callout>
      </Section>

      <Section group="Design" id="rbac" title="Staff roles" takeaway="Admins decide in the UI which actions each role allows, and give roles to people or groups; every call checks the live assignment.">
        <P>
          Today every staff member can call every procedure. The platform's roles are fixed in code
          (<Src path="libs/domain/src/rbac.ts" />), so backoffice needs its own, editable model. It keeps the platform's
          conventions: actions per area, and a write that implies its read.
        </P>
        <Table
          columns={['Piece', 'How it works']}
          rows={[
            ['Actions', <>A catalog in code. Every procedure declares one action: one read per area (<Id>tenants.read</Id>), one per write (<Id>tenants.suspend</Id>, <Id>flags.override</Id>, <Id>pipeline.trigger</Id>). A test fails when a procedure has none</>],
            ['Roles', 'Stored in Postgres and edited in the UI as a role × action grid. Admin is built in, holds every action and cannot be edited'],
            ['Groups', 'Named sets of staff, managed in the UI. One built-in group, All staff, holds everyone. Okta group sync can come later'],
            ['Assignments', 'A role goes to a person or a group. A person can do every action of every role they hold, directly or through a group'],
            ['The check', 'Per procedure, read from Postgres on every call, never from the token, so a change applies to the next call in the UI and the MCP alike'],
            ['New actions', 'Added in code, held only by Admin until someone ticks them for another role'],
            ['Staff list', 'A staff member gets a row on first sign-in (none exists today), and can then be added to groups and roles'],
          ]}
        />
        <Figure caption="Five new tables in the core Postgres database; one additive migration. A role keeps its actions as a list.">
          <StaffRolesSchema />
        </Figure>
        <Table
          columns={['Seeded role (editable)', 'Read everything', 'Trigger RMPO DAG runs', 'Per-tenant flag overrides', 'Suspend and restore tenants', 'Manage roles, global toggle, impersonation']}
          rows={[
            ['Viewer', 'yes', '—', '—', '—', '—'],
            ['Operator', 'yes', 'yes', 'yes', '—', '—'],
            ['Admin (built in)', 'yes', 'yes', 'yes', 'yes', 'yes'],
          ]}
        />
        <Callout title="Guardrails">
          Managing roles is itself an action (<Id>roles.manage</Id>), and the last person holding it cannot lose it
          (<Id>LastAdminError</Id>). Every role, group and assignment change lands in the audit log. At launch, All staff
          holds Admin, so nobody loses access; moving All staff to Viewer is the switch that turns roles on.
        </Callout>
        <P>
          MCP lists every tool to everyone (Podium's gateway keeps one tool list for all users), and a call beyond the
          person's actions returns a typed refusal that names the missing action.
        </P>
      </Section>

      <Section group="Design" id="connect" title="Connect it everywhere" takeaway="One Podium gateway entry and one org plugin entry put it in every staff member's agent.">
        <Grid cols={2}>
          <Card label="Podium" title="One gateway entry, like Terraplain" accent>
            <P>
              Add <Id>backoffice</Id> to <Ref href="https://github.com/act-security/infrastructure/blob/main/workspaces/act/shared-services-podium/locals-podium-tools.tf">locals-podium-tools.tf</Ref> with
              Auth0's endpoints and a confidential Auth0 app per Podium environment. An admin clicks "Authorize for
              everyone" once; each person clicks Connect. Agents then see <Id>backoffice___bo_*</Id> tools.
            </P>
          </Card>
          <Card label="Local Claude Code" title="One plugin entry">
            <P>
              Add the server to the <Id>act</Id> plugin in <Ref href="https://github.com/act-security/claude-code-plugins">act-security/claude-code-plugins</Ref>,
              so installing the plugin connects it. The first call opens the browser sign-in. Codex: <Id>codex mcp add</Id> + <Id>codex mcp login</Id>.
            </P>
          </Card>
        </Grid>
        <P>
          Podium's Connect button probes a read-only tool with no arguments. Terraplain has none because every tool takes
          an intent, so it has no Connect button. Add <Id>bo_whoami</Id> without one, and answer the empty prompts and
          resources lists the gateway's sync calls.
        </P>
      </Section>

      <Section group="Design" id="tools" title="Tools" takeaway="About 20 tools, trimmed by real usage before building.">
        <Table
          columns={['Area', 'Read tools (bo:read)', 'Write tools (bo:write)']}
          mono={[1, 2]}
          rows={[
            ['Tenants', 'tenants.list · getById · listNames', 'suspend · restore'],
            ['Feature flags', 'featureFlags.list', 'updateOverrides'],
            ['RMPO DAG', 'workflows.getPipelineStatus · snapshots.getManyByTenantIds', 'triggerRmpo · triggerAnalysis · triggerCampaigns · triggerSimulations'],
            ['Audit log', 'auditLog.*', '—'],
          ]}
        />
        <Grid cols={3}>
          <Card label="Annotations" title="Client asks first">
            <P>Every tool sets <Id>readOnlyHint</Id> or <Id>destructiveHint</Id>, so the client prompts before a write.</P>
          </Card>
          <Card label="Intent" title="Why, on every call">
            <P>Each tool takes a one-sentence <Id>intent</Id>, recorded in the audit row.</P>
          </Card>
          <Card label="Echo" title="IDs in, names out">
            <P>Writes take a tenant ID. The result echoes the tenant name and the DAG run link to check.</P>
          </Card>
        </Grid>
        <P>Pipeline triggers start a run of the tenant's RMPO DAG schedule (<Src path="apps/backoffice-service/src/adapters/clients/executor-snapshot-pipeline.client.ts" />); a tenant with no schedule yet gets a typed refusal. Before building, count audit-log rows per procedure over the last 90 days; procedures nobody calls don't get tools.</P>
      </Section>

      <Section group="Design" id="out-of-scope" title="Out of scope" takeaway="Impersonation and global flag toggles stay in the UI for v1.">
        <Table
          columns={['Left out', 'Why', 'Instead']}
          rows={[
            ['Impersonation', 'The procedure returns a live login link into a customer tenant; it would sit in the transcript and client logs', <><Id>/tenants/&lt;id&gt;?impersonate=1</Id> deep link, clicked in the staff member's own browser</>],
            ['Global flag toggle', 'One call changes every tenant at once', 'Per-tenant overrides; global toggles in the UI'],
          ]}
        />
      </Section>

      <Section group="Delivery" id="changes" title="Changes to existing code" takeaway="All in backoffice-service, plus infra for the client and Access paths.">
        <Changes
          rows={[
            { name: '/mcp route', area: 'api', after: 'SDK v2, stateless, per-request server', note: 'tools call procedures through createCaller' },
            { name: 'Discovery + token check', area: 'access', after: 'RFC 9728 metadata, JWT bound to /mcp', note: 'authorization server per the spike' },
            { name: 'Cloudflare Access app', area: 'config', before: 'every path behind Access', after: 'bypass /mcp, discovery, token, revoke' },
            { name: 'Audit row', area: 'data', before: 'actor', after: 'actor + via mcp + client + tool + intent' },
            { name: 'Staff roles', area: 'access', before: 'every staff member can call everything', after: 'action per procedure, roles and groups from Postgres', note: 'applies to the UI too' },
            { name: 'Core Postgres', area: 'data', after: 'five staff_* tables', note: 'one additive migration' },
            { name: 'Backoffice UI', area: 'ui', after: 'Roles, Groups and Staff pages' },
            { name: 'Audit middleware', area: 'behavior', before: 'mutations only', after: '+ every MCP call' },
            { name: 'Podium tools', area: 'config', after: 'backoffice entry + Auth0 app per environment', note: 'infrastructure repo' },
            { name: 'act plugin', area: 'config', after: 'backoffice MCP server entry', note: 'claude-code-plugins repo' },
          ]}
        />
      </Section>

      <Section group="Delivery" id="delivery" title="Delivery" takeaway="A half-day spike, then six PRs, roles first; about 9–12 days plus infra.">
        <Steps
          items={[
            { title: 'Spike on dev, then infrastructure + gitops', body: 'Spike, half a day: Auth0 CIMD registration and the resource profile on dev, Claude Code registered by hand, one read call, the audit row checked. Then the PR: Auth0 apps and the backoffice-mcp Access app (not sized yet).' },
            { title: 'backoffice-service: staff roles', body: 'About 2–3 days. Migration, action catalog, live check, seeded roles, All staff holding Admin. Its own PR: it changes the UI too and holds the one-way migration.' },
            { title: 'backoffice-client: Roles, Groups and Staff pages', body: 'About 2–3 days. Ships before anyone moves All staff off Admin.' },
            { title: 'backoffice-service: /mcp, then write tools', body: 'Two PRs: the route, auth, audit fields, bo_whoami and read tools (about 2 days), then the write tools (1–2 days).' },
            { title: 'Podium tool entry + act plugin entry', body: 'About half a day, once /mcp is live in prod.' },
          ]}
        />
      </Section>

      <Section group="Delivery" id="decisions" title="Open decisions" takeaway="Six calls; each has a recommendation.">
        <Table
          columns={['Decision', 'Options', 'Recommended']}
          rows={[
            ['Authorization server', 'Auth0 Auth for MCP · better-auth like Terraplain', <Chip kind="add">Auth0; better-auth only if the spike fails</Chip>],
            ['Clients', 'Local Claude Code · Podium · both', <Chip kind="add">Both</Chip>],
            ['Impersonation', 'Out · deep link · full URL', <Chip kind="add">Deep link only</Chip>],
            ['Role model', 'Three fixed roles · editable roles, groups, assignments', <Chip kind="add">Editable</Chip>],
            ['Groups', 'Managed in backoffice · synced from Okta', <Chip kind="add">Managed in backoffice; Okta later</Chip>],
          ]}
        />
      </Section>
    </Page>
  )
}
