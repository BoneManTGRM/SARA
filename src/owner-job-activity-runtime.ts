import { LEARNING_MAXIMUM_FAILED_ROOTS_PER_CAPABILITY } from "./learning-campaign.ts";

export const OWNER_JOB_ACTIVITY_MARKER = 'data-owner-job-activity="2026-09-11"';

const OWNER_JOB_ACTIVITY_STYLE = String.raw`<style ${OWNER_JOB_ACTIVITY_MARKER}>
.owner-job-activity {
  margin-top: 34px;
}
.owner-job-activity .activity-grid {
  display: grid;
  grid-template-columns: minmax(0, .88fr) minmax(0, 1.12fr);
  gap: 14px;
}
.owner-job-activity .activity-panel {
  min-width: 0;
  border: 1px solid rgba(69,233,255,.24);
  border-left: 3px solid var(--cyan);
  border-radius: 6px;
  background: linear-gradient(145deg, rgba(5,15,28,.96), rgba(5,10,21,.97));
  box-shadow: inset 0 0 24px rgba(69,233,255,.035);
  padding: 18px;
}
.owner-job-activity .activity-panel.current {
  border-left-color: var(--scanner-red, var(--coral));
}
.owner-job-activity .activity-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin: 0 0 14px;
}
.owner-job-activity .activity-chip {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  padding: 0 9px;
  border: 1px solid rgba(69,233,255,.20);
  border-radius: 3px;
  background: rgba(4,13,24,.76);
  color: #9dc7d9;
  font: 700 .58rem/1 var(--mono);
  letter-spacing: .055em;
  text-transform: uppercase;
}
.owner-job-activity .activity-chip.hot { border-color: rgba(255,49,93,.40); color: #ffd7e0; }
.owner-job-activity .activity-title {
  display: block;
  color: #effcff;
  font: 700 .82rem/1.35 var(--mono);
  overflow-wrap: anywhere;
}
.owner-job-activity .activity-copy,
.owner-job-activity .activity-meta {
  margin: 8px 0 0;
  color: #7898aa;
  font: .62rem/1.55 var(--mono);
  overflow-wrap: anywhere;
}
.owner-job-activity .activity-meta { color: #93bfd1; }
.owner-job-activity .activity-list {
  display: grid;
  gap: 8px;
  margin-top: 11px;
}
.owner-job-activity details {
  border: 1px solid rgba(69,233,255,.14);
  border-radius: 4px;
  background: rgba(2,8,16,.64);
  padding: 10px 11px;
}
.owner-job-activity details[open] { border-color: rgba(69,233,255,.30); }
.owner-job-activity summary {
  cursor: pointer;
  color: #d8f6ff;
  font: 700 .64rem/1.4 var(--mono);
  overflow-wrap: anywhere;
}
.owner-job-activity .activity-raw {
  margin: 12px 0 0;
  padding-top: 10px;
  border-top: 1px solid rgba(69,233,255,.11);
  color: #5f7f92;
  font: .57rem/1.5 var(--mono);
}
@media (max-width: 720px) {
  .owner-job-activity .activity-grid { grid-template-columns: minmax(0, 1fr); }
  .owner-job-activity .activity-panel { padding: 15px; }
}
</style>`;

const OWNER_JOB_ACTIVITY_PANEL = String.raw`
      <section class="chapter owner-job-activity" aria-labelledby="owner-job-activity-title">
        <div class="chapter-head">
          <div>
            <span class="chapter-index">01A // LIVE ACTIVITY</span>
            <h2 id="owner-job-activity-title">What SARA<br>is doing.</h2>
          </div>
          <div>
            <p class="chapter-note">Jobs are grouped by useful outcome. Learning retries stay inside the same objective instead of masquerading as new accomplishments.</p>
            <p class="connection-state" id="owner-job-activity-state">Owner authentication required</p>
          </div>
        </div>
        <div class="activity-summary" id="owner-job-activity-summary" aria-live="polite"></div>
        <div class="activity-grid">
          <div class="activity-panel current" id="owner-job-current">
            <span class="activity-title">Owner state locked</span>
            <p class="activity-copy">Authenticate to inspect current work.</p>
          </div>
          <div class="activity-panel">
            <span class="card-label">Useful job ledger</span>
            <div class="activity-list" id="owner-job-list"><p class="activity-copy">Owner state locked.</p></div>
            <p class="activity-raw" id="owner-job-raw">Raw execution records remain private.</p>
          </div>
        </div>
      </section>
`;

const OWNER_JOB_ACTIVITY_SCRIPT = String.raw`
    const ownerLearningRetryCeiling = ${LEARNING_MAXIMUM_FAILED_ROOTS_PER_CAPABILITY};

    function ownerJobStatus(records) {
      const statuses = new Set(records.map((job) => String(job.status || '').toLowerCase()));
      const failedFreshRoots = records.filter((job) => String(job.status || '').toLowerCase() === 'failed' && !job.learningParentJobId).length;
      if (statuses.has('running') || statuses.has('active') || statuses.has('verifying')) return 'RUNNING';
      if (statuses.has('blocked') || (statuses.has('authorized') && failedFreshRoots >= ownerLearningRetryCeiling)) return 'BLOCKED';
      if (statuses.has('authorized') || statuses.has('scoped') || statuses.has('new')) return 'QUEUED';
      if (statuses.has('verified') || statuses.has('done') || statuses.has('completed') || statuses.has('qualified')) return 'COMPLETED';
      if (statuses.has('failed')) return 'FAILED';
      return 'UNKNOWN';
    }

    function ownerJobStep(status) {
      if (status === 'RUNNING') return 'Executing bounded work or verifying evidence.';
      if (status === 'BLOCKED') return 'Blocked. A dependency, failure, or owner-visible decision must change before work continues.';
      if (status === 'QUEUED') return 'Authorized or scoped and waiting for its next bounded step.';
      if (status === 'COMPLETED') return 'Useful outcome completed and retained.';
      if (status === 'FAILED') return 'Stopped after failure. Failure evidence remains in the immutable audit.';
      return 'State requires inspection.';
    }

    function ownerJobTimestamp(value) {
      const parsed = Date.parse(value || '');
      return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : 'time unavailable';
    }

    function ownerJobGroups(jobs) {
      const groups = new Map();
      for (const job of jobs) {
        const learning = Boolean(job && job.learningCampaignId && job.learningCapabilityId);
        const key = learning
          ? ['learning', job.learningCampaignId, job.learningCapabilityId, job.learningSourceJobId || 'unknown-source'].join(':')
          : 'job:' + String(job && job.id || 'unknown');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(job);
      }
      return Array.from(groups.entries()).map(([key, records]) => {
        records.sort((a, b) => Date.parse((a.workCard && a.workCard.createdAt) || '') - Date.parse((b.workCard && b.workCard.createdAt) || ''));
        const latest = records[records.length - 1] || {};
        const card = latest.workCard || {};
        return {
          key,
          records,
          latest,
          status: ownerJobStatus(records),
          objective: String(card.objective || latest.learningCapabilityId || latest.id || 'Unnamed bounded job'),
          ownerValue: Number(card.expectedOwnerValue || 0),
          maximumBudgetUsd: Number(card.maximumBudgetUsd || 0),
          criteriaCount: Array.isArray(card.acceptanceCriteria) ? card.acceptanceCriteria.length : 0,
          capabilityId: latest.learningCapabilityId || '',
          campaignId: latest.learningCampaignId || '',
          createdAt: card.createdAt || '',
        };
      });
    }

    function renderOwnerJobActivity(state) {
      const jobs = Array.isArray(state.jobs) ? state.jobs : [];
      const groups = ownerJobGroups(jobs);
      const rank = { RUNNING: 0, BLOCKED: 1, QUEUED: 2, FAILED: 3, COMPLETED: 4, UNKNOWN: 5 };
      groups.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
      const counts = { RUNNING: 0, BLOCKED: 0, QUEUED: 0, COMPLETED: 0, FAILED: 0, UNKNOWN: 0 };
      for (const group of groups) counts[group.status] = (counts[group.status] || 0) + 1;
      const learningRecords = jobs.filter((job) => Boolean(job && job.learningCampaignId)).length;

      const stateNode = document.querySelector('#owner-job-activity-state');
      const summary = document.querySelector('#owner-job-activity-summary');
      const current = document.querySelector('#owner-job-current');
      const list = document.querySelector('#owner-job-list');
      const raw = document.querySelector('#owner-job-raw');
      if (!stateNode || !summary || !current || !list || !raw) return { usefulJobs: groups.length };

      stateNode.textContent = counts.RUNNING > 0 ? 'SARA is working' : counts.BLOCKED > 0 ? 'Work is blocked' : counts.QUEUED > 0 ? 'Work is queued' : 'No active execution';
      summary.replaceChildren();
      const summaryItems = [
        [counts.RUNNING + ' running', counts.RUNNING > 0],
        [counts.BLOCKED + ' blocked', counts.BLOCKED > 0],
        [counts.QUEUED + ' queued', false],
        [counts.COMPLETED + ' completed', false],
        [counts.FAILED + ' failed', counts.FAILED > 0],
        [groups.length + ' useful jobs', false],
      ];
      for (const item of summaryItems) {
        const chip = document.createElement('span');
        chip.className = 'activity-chip' + (item[1] ? ' hot' : '');
        chip.textContent = item[0];
        summary.append(chip);
      }

      const active = groups.find((group) => group.status === 'RUNNING')
        || groups.find((group) => group.status === 'BLOCKED')
        || groups.find((group) => group.status === 'QUEUED');
      current.replaceChildren();
      const currentTitle = document.createElement('span');
      currentTitle.className = 'activity-title';
      currentTitle.textContent = active ? active.objective : 'SARA is idle';
      const currentStep = document.createElement('p');
      currentStep.className = 'activity-copy';
      currentStep.textContent = active ? ownerJobStep(active.status) : 'No job is currently running, blocked, or queued.';
      const currentMeta = document.createElement('p');
      currentMeta.className = 'activity-meta';
      currentMeta.textContent = active
        ? 'Status ' + active.status + ' · run records ' + active.records.length + ' · max spend ' + money(active.maximumBudgetUsd)
          + ' · owner value ' + active.ownerValue + (active.capabilityId ? ' · capability ' + active.capabilityId : '')
        : groups.length + ' useful job groups retained.';
      current.append(currentTitle, currentStep, currentMeta);

      list.replaceChildren();
      if (!groups.length) {
        const empty = document.createElement('p');
        empty.className = 'activity-copy';
        empty.textContent = 'No bounded jobs have been recorded.';
        list.append(empty);
      } else {
        for (const group of groups.slice(0, 10)) {
          const details = document.createElement('details');
          const heading = document.createElement('summary');
          heading.textContent = group.status + ' · ' + group.objective;
          const step = document.createElement('p');
          step.className = 'activity-copy';
          step.textContent = ownerJobStep(group.status);
          const meta = document.createElement('p');
          meta.className = 'activity-meta';
          meta.textContent = 'Run records ' + group.records.length + ' · latest ' + ownerJobTimestamp(group.createdAt)
            + ' · max spend ' + money(group.maximumBudgetUsd) + ' · acceptance checks ' + group.criteriaCount
            + (group.capabilityId ? ' · capability ' + group.capabilityId : '')
            + (group.campaignId ? ' · authority ' + group.campaignId : ' · bounded job record');
          details.append(heading, step, meta);
          list.append(details);
        }
      }
      raw.textContent = jobs.length + ' raw job records · ' + learningRecords + ' learning run records. Repeated learning runs are grouped by campaign, capability, and source objective.';
      return { usefulJobs: groups.length, running: counts.RUNNING, blocked: counts.BLOCKED, queued: counts.QUEUED, completed: counts.COMPLETED, failed: counts.FAILED, rawJobs: jobs.length, learningRecords };
    }
`;

const PANEL_ANCHOR = '      <div class="future-strip" aria-label="SARA development path">';
const SCRIPT_ANCHOR = '    async function loadPrivateState() {';
const JOB_COUNT_ANCHOR = "      document.querySelector('#jobs').textContent = String(state.jobs.length);";
const JOB_LABEL_ANCHOR = '<div class="micro-stat"><span>Jobs</span><strong id="jobs">—</strong></div>';

/**
 * Adds an owner-only, read-only projection over existing protected job state.
 * It changes presentation only: no authority, job state, or API route is widened.
 */
export function applyOwnerJobActivityPanel(html: string): string {
  if (
    html.includes(OWNER_JOB_ACTIVITY_MARKER) ||
    !html.includes('<title>SARA // Owner Command Center</title>') ||
    !html.includes('</head>') ||
    !html.includes(PANEL_ANCHOR) ||
    !html.includes(SCRIPT_ANCHOR) ||
    !html.includes(JOB_COUNT_ANCHOR) ||
    !html.includes(JOB_LABEL_ANCHOR)
  ) {
    return html;
  }

  const workAnchor = '<div id="owner-work-results" aria-live="polite"></div>';
  const activityPanel = html.includes(workAnchor)
    ? OWNER_JOB_ACTIVITY_PANEL.replace('      </section>', '        <div class="activity-panel"><span class="activity-title">Conversation work and evidence</span>' + workAnchor + '</div>\n      </section>')
    : OWNER_JOB_ACTIVITY_PANEL;
  return html
    .replace(workAnchor, '<a class="button" href="#owner-work-results">View conversation work and evidence</a>')
    .replace('</head>', `${OWNER_JOB_ACTIVITY_STYLE}</head>`)
    .replace(PANEL_ANCHOR, `${activityPanel}\n${PANEL_ANCHOR}`)
    .replace(JOB_LABEL_ANCHOR, '<div class="micro-stat"><span>Useful jobs</span><strong id="jobs">—</strong></div>')
    .replace(SCRIPT_ANCHOR, `${OWNER_JOB_ACTIVITY_SCRIPT}\n${SCRIPT_ANCHOR}`)
    .replace(JOB_COUNT_ANCHOR, "      const ownerJobActivity = renderOwnerJobActivity(state);\n      document.querySelector('#jobs').textContent = String(ownerJobActivity.usefulJobs);");
}
