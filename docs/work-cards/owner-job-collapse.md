# Collapsible owner activity

Owner request: add collapsible arrows to the current-job card, Useful Job Ledger, and Conversation Work and Evidence shown in the mobile screenshots.

Acceptance: all three sections use keyboard-accessible native disclosure controls and start collapsed. Job summaries show status and a bounded title; expansion retains the complete objective, status explanation, metadata, and evidence. Refresh preserves disclosure choices. Mobile content stays within the viewport. Existing conversation links still reveal the result area. No job, authority, accounting, or durable-state behavior changes.

Scope: existing owner activity presentation and its browser qualification. Preserve existing work and deployment approval requirements. Local verification and PR evidence do not constitute production promotion approval.

Required-gate follow-up: CI run 34735893339 passed actual sandbox browser and desktop/mobile owner UI qualification, then failed the existing queue-deadline test (1 failure among 1,394 tests). Its two-millisecond setup deadline could expire before both active slots were established. The test now uses the existing default deadline and Node mock timers to expire only the queued task, explicitly checks that active tasks remain active, and drains them in cleanup. Production queue behavior is unchanged. All five focused queue tests passed.
