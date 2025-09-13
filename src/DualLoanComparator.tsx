import React, { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  AreaChart,
  Area,
} from "recharts";

/* ============================================================
   Utility Helpers
   ============================================================ */
const INR = (n: number) =>
  n?.toLocaleString("en-IN", { maximumFractionDigits: 0 });

const fmtINR = (n: number) =>
  n?.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

function emi(P: number, r: number, N: number) {
  if (P <= 0 || N <= 0) return 0;
  if (r === 0) return P / N;
  const f = Math.pow(1 + r, N);
  return (P * r * f) / (f - 1);
}

/* ============================================================
   Types
   ============================================================ */
interface StepUpConfig {
  mode: "none" | "monthly_add" | "yearly_percent";
  value: number;
}

interface PrepayConfig {
  oneTimeAmount: number;
  oneTimeMonth: number;
  recurringAnnualAmount: number;
}

interface ODConfig {
  enabled: boolean;
  startSavings: number;
  monthlyIncrement: number;
  partFromSavingsEveryYYears: number;
  partAmountEachTime: number;
}

interface LoanInput {
  label: string;
  principal: number;
  years: number;
  monthsExtra: number;
  annualRate: number;
  stepUp: StepUpConfig;
  prepay: PrepayConfig;
  od: ODConfig;
}

interface MonthRow {
  monthIndex: number;
  year: number;
  openingPrincipal: number;
  savingsBalance: number;
  effectivePrincipal: number;
  rateMonthly: number;
  interest: number;
  scheduledEmi: number;
  principalPaid: number;
  prepayment: number;
  closingPrincipal: number;
  closingSavings: number;
}

interface SimulationResult {
  rows: MonthRow[];
  totalInterest: number;
  totalPaid: number;
  months: number;
  payoffDateNote: string;
}

/* ============================================================
   Core Simulation
   ============================================================ */
function simulateLoan(input: LoanInput): SimulationResult {
  const { principal: P0, years, monthsExtra, annualRate, stepUp, prepay, od } =
    input;

  const totalTenureMonths = years * 12 + monthsExtra;
  const rMonthlyBase = annualRate / 1200;

  // Base EMI for starting schedule (may step up later)
  const baseEmi = emi(P0, rMonthlyBase, totalTenureMonths);

  let bal = P0;
  let savings = od.enabled ? od.startSavings : 0;
  let schedEmi = baseEmi;

  const rows: MonthRow[] = [];
  let m = 0;
  let totalInterest = 0;

  const applyStepUp = (month: number) => {
    if (stepUp.mode === "monthly_add" && stepUp.value > 0) {
      return schedEmi + stepUp.value;
    }
    if (stepUp.mode === "yearly_percent" && stepUp.value > 0) {
      if (month > 0 && month % 12 === 0) {
        schedEmi = schedEmi * (1 + stepUp.value / 100);
      }
      return schedEmi;
    }
    return schedEmi;
  };

  const computePrepay = (month: number) => {
    let extra = 0;
    if (prepay.oneTimeAmount > 0 && month === prepay.oneTimeMonth)
      extra += prepay.oneTimeAmount;
    if (prepay.recurringAnnualAmount > 0 && month > 0 && month % 12 === 0)
      extra += prepay.recurringAnnualAmount;
    return extra;
  };

  const fromSavingsIntervalMonths = Math.max(
    0,
    (od.partFromSavingsEveryYYears || 0) * 12
  );

  // Run month-by-month simulation (hard cap 1200 months for safety)
  while (bal > 0 && m < 1200) {
    schedEmi = applyStepUp(m);

    if (od.enabled && od.monthlyIncrement !== 0) {
      savings = Math.max(0, savings + od.monthlyIncrement);
    }

    const effectivePrincipal = Math.max(0, bal - (od.enabled ? savings : 0));
    const interest = effectivePrincipal * rMonthlyBase;

    let extraPrepay = computePrepay(m);

    // Periodic transfer from OD savings to principal
    if (
      od.enabled &&
      fromSavingsIntervalMonths > 0 &&
      m > 0 &&
      m % fromSavingsIntervalMonths === 0
    ) {
      const transferable = Math.min(od.partAmountEachTime, savings);
      if (transferable > 0) {
        extraPrepay += transferable;
        savings -= transferable;
      }
    }

    // Don't pay beyond the final due
    const dueThisMonth = Math.min(schedEmi, bal + interest);
    const principalPaid = Math.max(0, dueThisMonth - interest);
    const capPrepay = Math.min(extraPrepay, Math.max(0, bal - principalPaid));
    const closingPrincipal = Math.max(0, bal - principalPaid - capPrepay);

    rows.push({
      monthIndex: m,
      year: Math.floor(m / 12) + 1,
      openingPrincipal: bal,
      savingsBalance: savings,
      effectivePrincipal,
      rateMonthly: rMonthlyBase,
      interest,
      scheduledEmi: dueThisMonth,
      principalPaid,
      prepayment: capPrepay,
      closingPrincipal,
      closingSavings: savings,
    });

    totalInterest += interest;
    bal = closingPrincipal;
    m += 1;
  }

  const months = m;
  const yearsPart = Math.floor(months / 12);
  const remMonths = months % 12;
  const payoffDateNote = `${yearsPart}y ${remMonths}m`;

  const totalPaid = rows.reduce(
    (sum, r) => sum + r.scheduledEmi + r.prepayment,
    0
  );

  return { rows, totalInterest, totalPaid, months, payoffDateNote };
}

/* ============================================================
   UI — Reusable Inputs
   ============================================================ */
function NumberField({
  label,
  value,
  onChange,
  min = 0,
  step = 1,
  suffix = "",
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-gray-700">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          className="w-full rounded-2xl border p-2 shadow-sm focus:outline-none"
          value={value}
          min={min}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {suffix && <span className="text-gray-500 text-xs">{suffix}</span>}
      </div>
    </label>
  );
}

function StepUpEditor({
  value,
  onChange,
}: {
  value: StepUpConfig;
  onChange: (s: StepUpConfig) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <label className="col-span-3 text-sm text-gray-700">Increase in EMI</label>
      <select
        className="col-span-2 rounded-2xl border p-2"
        value={value.mode}
        onChange={(e) =>
          onChange({ ...value, mode: e.target.value as StepUpConfig["mode"] })
        }
      >
        <option value="none">No increase</option>
        <option value="monthly_add">Add amount every month</option>
        <option value="yearly_percent">Increase % every year</option>
      </select>
      <input
        type="number"
        className="rounded-2xl border p-2"
        placeholder={
          value.mode === "yearly_percent" ? "% per year" : "₹ per month"
        }
        value={value.value}
        min={0}
        onChange={(e) =>
          onChange({ ...value, value: Number(e.target.value) })
        }
      />
    </div>
  );
}

function PrepayEditor({
  value,
  onChange,
}: {
  value: PrepayConfig;
  onChange: (p: PrepayConfig) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <label className="col-span-3 text-sm text-gray-700">Prepayment</label>
      <NumberField
        label="One-time amount (₹)"
        value={value.oneTimeAmount}
        onChange={(n) =>
          onChange({ ...value, oneTimeAmount: Math.max(0, n) })
        }
      />
      <NumberField
        label="One-time at month #"
        value={value.oneTimeMonth}
        onChange={(n) =>
          onChange({ ...value, oneTimeMonth: Math.max(0, Math.floor(n)) })
        }
      />
      <NumberField
        label="Recurring annual prepay (₹)"
        value={value.recurringAnnualAmount}
        onChange={(n) =>
          onChange({ ...value, recurringAnnualAmount: Math.max(0, n) })
        }
      />
    </div>
  );
}

function ODEditor({
  value,
  onChange,
}: {
  value: ODConfig;
  onChange: (o: ODConfig) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="col-span-3 flex items-center gap-2">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) =>
            onChange({ ...value, enabled: e.target.checked })
          }
        />
        <span className="text-sm text-gray-700">
          Enable OD linked savings offset
        </span>
      </div>
      <NumberField
        label="Start savings (₹)"
        value={value.startSavings}
        onChange={(n) =>
          onChange({ ...value, startSavings: Math.max(0, n) })
        }
      />
      <NumberField
        label="Monthly increment (₹)"
        value={value.monthlyIncrement}
        onChange={(n) => onChange({ ...value, monthlyIncrement: n })}
      />
      <NumberField
        label="Every Y years transfer (Y)"
        value={value.partFromSavingsEveryYYears}
        onChange={(n) =>
          onChange({
            ...value,
            partFromSavingsEveryYYears: Math.max(0, Math.floor(n)),
          })
        }
      />
      <NumberField
        label="Transfer amount each time (₹)"
        value={value.partAmountEachTime}
        onChange={(n) =>
          onChange({ ...value, partAmountEachTime: Math.max(0, n) })
        }
      />
    </div>
  );
}

function LoanEditor({
  value,
  onChange,
}: {
  value: LoanInput;
  onChange: (v: LoanInput) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <NumberField
        label="Loan amount (₹)"
        value={value.principal}
        onChange={(n) => onChange({ ...value, principal: Math.max(0, n) })}
      />
      <NumberField
        label="Tenure years"
        value={value.years}
        onChange={(n) =>
          onChange({ ...value, years: Math.max(0, Math.floor(n)) })
        }
      />
      <NumberField
        label="Extra months"
        value={value.monthsExtra}
        onChange={(n) =>
          onChange({ ...value, monthsExtra: Math.max(0, Math.floor(n)) })
        }
      />
      <NumberField
        label="Interest rate (% p.a.)"
        value={value.annualRate}
        onChange={(n) =>
          onChange({ ...value, annualRate: Math.max(0, n) })
        }
      />

      <div className="col-span-3 p-3 rounded-2xl border bg-white/60 shadow-sm">
        <StepUpEditor
          value={value.stepUp}
          onChange={(s) => onChange({ ...value, stepUp: s })}
        />
      </div>

      <div className="col-span-3 p-3 rounded-2xl border bg-white/60 shadow-sm">
        <PrepayEditor
          value={value.prepay}
          onChange={(p) => onChange({ ...value, prepay: p })}
        />
      </div>

      <div className="col-span-3 p-3 rounded-2xl border bg-white/60 shadow-sm">
        <ODEditor value={value.od} onChange={(o) => onChange({ ...value, od: o })} />
      </div>
    </div>
  );
}

/* ============================================================
   Summary & Insights
   ============================================================ */
function SummaryCard({
  title,
  result,
}: {
  title: string;
  result: SimulationResult;
}) {
  const yrs = Math.floor(result.months / 12);
  const mos = result.months % 12;
  const initialEmi = result.rows[0]?.scheduledEmi ?? 0; // Show EMI as requested
  return (
    <div className="rounded-2xl border p-4 bg-white shadow-md hover:shadow-lg transition-shadow">
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <span className="text-gray-600">Starting EMI</span>
        <span className="text-right font-medium">₹{fmtINR(initialEmi)}</span>

        <span className="text-gray-600">Total Interest Paid</span>
        <span className="text-right font-medium">₹{fmtINR(result.totalInterest)}</span>

        <span className="text-gray-600">Total Paid (EMI + Prepay)</span>
        <span className="text-right font-medium">₹{fmtINR(result.totalPaid)}</span>

        <span className="text-gray-600">Payoff Time</span>
        <span className="text-right font-medium">
          {yrs}y {mos}m
        </span>
      </div>
    </div>
  );
}

function Insights({
  A,
  B,
  labelA,
  labelB,
}: {
  A: SimulationResult;
  B: SimulationResult;
  labelA: string;
  labelB: string;
}) {
  const interestDiff = A.totalInterest - B.totalInterest;
  const faster =
    A.months < B.months
      ? labelA
      : A.months > B.months
      ? labelB
      : "Both equal";
  const fasterBy = Math.abs(A.months - B.months);
  const yrs = Math.floor(fasterBy / 12);
  const mos = fasterBy % 12;

  return (
    <div className="rounded-2xl border p-4 bg-amber-50 shadow-sm">
      <h4 className="font-semibold mb-2">Auto Insights</h4>
      <ul className="list-disc pl-6 text-sm space-y-2">
        <li>
          <span className="font-medium">Interest Advantage:</span>{" "}
          {interestDiff === 0 ? (
            "No difference"
          ) : interestDiff > 0 ? (
            <span className="ml-2 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs">
              {labelB} saves ₹{fmtINR(interestDiff)} vs {labelA}
            </span>
          ) : (
            <span className="ml-2 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs">
              {labelA} saves ₹{fmtINR(-interestDiff)} vs {labelB}
            </span>
          )}
        </li>
        <li>
          <span className="font-medium">Faster Closure:</span>{" "}
          {faster} closes earlier by {yrs}y {mos}m.
        </li>
        <li>
          If your OD savings grow steadily, the{" "}
          <span className="font-medium">effective rate</span> drops because
          interest is charged on (principal − savings). Consider increasing
          monthly OD deposits during high-cashflow months.
        </li>
        <li>
          Annual prepayments are most powerful early in tenure. Moving savings
          every <span className="font-medium">Y</span> years directly to
          principal can cut interest significantly.
        </li>
      </ul>
    </div>
  );
}

/* ============================================================
   Chart Data
   ============================================================ */
function mergeForChart(
  A: SimulationResult,
  B: SimulationResult,
  labelA: string,
  labelB: string
) {
  const maxLen = Math.max(A.rows.length, B.rows.length);
  const data: any[] = [];
  for (let i = 0; i < maxLen; i++) {
    data.push({
      m: i + 1,
      [`${labelA} Principal`]: A.rows[i]?.closingPrincipal ?? null,
      [`${labelB} Principal`]: B.rows[i]?.closingPrincipal ?? null,
      [`${labelA} Savings`]: A.rows[i]?.closingSavings ?? null,
      [`${labelB} Savings`]: B.rows[i]?.closingSavings ?? null,
      [`${labelA} Interest`]: A.rows[i]?.interest ?? null,
      [`${labelB} Interest`]: B.rows[i]?.interest ?? null,
    });
  }
  return data;
}

/* ============================================================
   Main Component
   ============================================================ */
export default function DualLoanComparator() {
  const [loanA, setLoanA] = useState<LoanInput>({
    label: "Loan A",
    principal: 7500000,
    years: 25,
    monthsExtra: 0,
    annualRate: 7.7,
    stepUp: { mode: "none", value: 0 },
    prepay: { oneTimeAmount: 0, oneTimeMonth: 0, recurringAnnualAmount: 0 },
    od: {
      enabled: true,
      startSavings: 500000,
      monthlyIncrement: 10000,
      partFromSavingsEveryYYears: 2,
      partAmountEachTime: 200000,
    },
  });

  const [loanB, setLoanB] = useState<LoanInput>({
    label: "Loan B",
    principal: 7500000,
    years: 25,
    monthsExtra: 0,
    annualRate: 7.5,
    stepUp: { mode: "yearly_percent", value: 5 },
    prepay: { oneTimeAmount: 0, oneTimeMonth: 0, recurringAnnualAmount: 100000 },
    od: {
      enabled: false,
      startSavings: 0,
      monthlyIncrement: 0,
      partFromSavingsEveryYYears: 0,
      partAmountEachTime: 0,
    },
  });

  const simA = useMemo(() => simulateLoan(loanA), [loanA]);
  const simB = useMemo(() => simulateLoan(loanB), [loanB]);

  const chartData = useMemo(
    () => mergeForChart(simA, simB, loanA.label, loanB.label),
    [simA, simB, loanA.label, loanB.label]
  );

  const effectiveRate = (sim: SimulationResult, input: LoanInput) => {
    // Simple rough approximation for effective rate across tenure
    const yrs = sim.months / 12;
    const avgOutstanding = input.principal / 2;
    const eff = (sim.totalInterest / (avgOutstanding * yrs)) * 100;
    return isFinite(eff) ? eff : 0;
    // Note: For exact XIRR-style effective rate, compute IRR on the monthly cash flows.
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100">
      <div className="p-4 md:p-8 max-w-7xl mx-auto font-sans">
        <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
          <span className="text-blue-600">📊</span> Dual Loan Comparator
        </h1>
        <p className="text-gray-600 mb-6">
          Compare <span className="font-semibold">two loan scenarios</span> with
          step-up EMIs, prepayments, and OD-linked savings. Adjust inputs below
          and instantly see payoff time, interest savings, and growth
          trajectories.
        </p>

        {/* Editors */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="rounded-2xl border p-4 bg-white shadow-md">
            <h2 className="font-semibold text-lg mb-3">{loanA.label}</h2>
            <LoanEditor value={loanA} onChange={setLoanA} />
          </div>
          <div className="rounded-2xl border p-4 bg-white shadow-md">
            <h2 className="font-semibold text-lg mb-3">{loanB.label}</h2>
            <LoanEditor value={loanB} onChange={setLoanB} />
          </div>
        </div>

        {/* Summaries */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <SummaryCard title={`${loanA.label} Summary`} result={simA} />
          <SummaryCard title={`${loanB.label} Summary`} result={simB} />
          <div className="rounded-2xl border p-4 bg-white shadow-md hover:shadow-lg transition-shadow">
            <h3 className="text-lg font-semibold mb-2">Quick Comparison</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <span className="text-gray-600">Effective Rate (approx)</span>
              <span className="text-right font-medium">
                {loanA.label}: {effectiveRate(simA, loanA).toFixed(2)}% /{" "}
                {loanB.label}: {effectiveRate(simB, loanB).toFixed(2)}%
              </span>
              <span className="text-gray-600">Payoff (Years:Months)</span>
              <span className="text-right font-medium">
                {simA.payoffDateNote} vs {simB.payoffDateNote}
              </span>
              <span className="text-gray-600">Interest Diff</span>
              <span className="text-right font-medium">
                ₹{fmtINR(Math.abs(simA.totalInterest - simB.totalInterest))}
              </span>
            </div>
          </div>
        </div>

        <Insights A={simA} B={simB} labelA={loanA.label} labelB={loanB.label} />

        {/* Charts */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 my-6">
          <div className="rounded-2xl border p-4 bg-white h-[360px] shadow-sm">
            <h3 className="font-semibold mb-2">
              Outstanding Principal Over Time
            </h3>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="m" tick={{ fontSize: 12 }} />
                <YAxis
                  tickFormatter={(v) => (v >= 0 ? `₹${INR(v)}` : "")}
                  tick={{ fontSize: 12 }}
                />
                <Tooltip
                  formatter={(v: any, name) => [`₹${INR(Number(v))}`, name]}
                  labelFormatter={(l) => `Month ${l}`}
                />
                <Legend />
                <Line
                  dot={false}
                  type="monotone"
                  dataKey={`${loanA.label} Principal`}
                  stroke="#2563eb"
                  strokeWidth={2}
                />
                <Line
                  dot={false}
                  type="monotone"
                  dataKey={`${loanB.label} Principal`}
                  stroke="#f59e0b"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-2xl border p-4 bg-white h-[360px] shadow-sm">
            <h3 className="font-semibold mb-2">OD Savings Balance Over Time</h3>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="m" tick={{ fontSize: 12 }} />
                <YAxis
                  tickFormatter={(v) => (v >= 0 ? `₹${INR(v)}` : "")}
                  tick={{ fontSize: 12 }}
                />
                <Tooltip
                  formatter={(v: any, name) => [`₹${INR(Number(v))}`, name]}
                  labelFormatter={(l) => `Month ${l}`}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey={`${loanA.label} Savings`}
                  stroke="#2563eb"
                  fill="#2563eb"
                  fillOpacity={0.15}
                />
                <Area
                  type="monotone"
                  dataKey={`${loanB.label} Savings`}
                  stroke="#f59e0b"
                  fill="#f59e0b"
                  fillOpacity={0.15}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-2xl border p-4 bg-white shadow-md">
          <h3 className="font-semibold mb-2">
            Per-Month Breakdown
          </h3>
          <div className="overflow-auto max-h-[420px]">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-100 sticky top-0">
                <tr>
                  <th className="p-2 text-left">Month</th>
                  <th className="p-2 text-left">{loanA.label} EMI</th>
                  <th className="p-2 text-left">{loanA.label} Interest</th>
                  <th className="p-2 text-left">{loanA.label} Prepay</th>
                  <th className="p-2 text-left">{loanA.label} Closing</th>
                  <th className="p-2 text-left">{loanB.label} EMI</th>
                  <th className="p-2 text-left">{loanB.label} Interest</th>
                  <th className="p-2 text-left">{loanB.label} Prepay</th>
                  <th className="p-2 text-left">{loanB.label} Closing</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: Math.max(simA.rows.length, simB.rows.length) }).map(
                  (_, idx) => (
                    <tr
                      key={idx}
                      className="odd:bg-white even:bg-gray-50 whitespace-nowrap"
                    >
                      <td className="p-2">{idx + 1}</td>

                      {/* Loan A */}
                      <td className="p-2 bg-blue-50">
                        ₹{INR(simA.rows[idx]?.scheduledEmi ?? 0)}
                      </td>
                      <td className="p-2 bg-blue-50">
                        ₹{INR(simA.rows[idx]?.interest ?? 0)}
                      </td>
                      <td className="p-2 bg-blue-50">
                        ₹{INR(simA.rows[idx]?.prepayment ?? 0)}
                      </td>
                      <td className="p-2 bg-blue-50">
                        ₹{INR(simA.rows[idx]?.closingPrincipal ?? 0)}
                      </td>

                      {/* Loan B */}
                      <td className="p-2 bg-green-50">
                        ₹{INR(simB.rows[idx]?.scheduledEmi ?? 0)}
                      </td>
                      <td className="p-2 bg-green-50">
                        ₹{INR(simB.rows[idx]?.interest ?? 0)}
                      </td>
                      <td className="p-2 bg-green-50">
                        ₹{INR(simB.rows[idx]?.prepayment ?? 0)}
                      </td>
                      <td className="p-2 bg-green-50">
                        ₹{INR(simB.rows[idx]?.closingPrincipal ?? 0)}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <footer className="text-xs text-gray-500 mt-8 border-t pt-4">
          💡 Notes: OD savings offset reduces the interest-bearing principal but
          isn’t repayment until transferred. “Starting EMI” in the summary is the
          first month’s scheduled EMI; it may change later due to step-ups or
          near-closure adjustments.
        </footer>
      </div>
    </div>
  );
}
