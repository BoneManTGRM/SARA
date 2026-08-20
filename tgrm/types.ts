export type ConstraintKind = "must_not" | "must_include" | "keep_fact";

export type Constraint = {
  id: string;
  kind: ConstraintKind;
  body: string;
  aliases: string[];
  active: boolean;
};

export type Fault = {
  type: ConstraintKind;
  ruleId: string;
  ruleBody: string;
  span: string;
  note: string;
};

export type DiffHunk = {
  type: "eq" | "del" | "ins";
  text: string;
};

export type RepairLog = {
  faults: Fault[];
  before: string;
  after: string;
  verified: boolean;
  rolledBack: boolean;
  method: "local" | "model" | "none";
  tokensDetect: number;
  tokensRepair: number;
  rye: number;
  yield: number;
  energy: number;
  notes: string[];
  constraintTotal: number;
  constraintHolding: number;
  retain: number;
};

export type TgrmInput = {
  text: string;
  constraints: Constraint[];
  tgrmEnabled: boolean;
};

export type TgrmResult = {
  text: string;
  log: RepairLog;
};
