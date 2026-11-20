import React, { useState } from "react";
import { X, BookOpen, Calculator, ShieldCheck, ExternalLink } from "../common/Icons";
import type { InspectorTarget } from "../../types/provenance";

interface ProvenanceDrawerProps {
  target: InspectorTarget | null;
  onClose: () => void;
  onSubmitCorrection: (target: InspectorTarget, correctedValue: string, rationale: string) => void;
}

export function ProvenanceDrawer({
  target,
  onClose,
  onSubmitCorrection,
}: ProvenanceDrawerProps): React.ReactElement | null {
  const [correctedVal, setCorrectedVal] = useState("");
  const [rationale, setRationale] = useState("");
  const [submittedMsg, setSubmittedMsg] = useState("");

  if (!target) return null;

  const { provenance } = target;
  const badgeColor =
    provenance.status === "primary_source"
      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
      : provenance.status === "derived"
      ? "bg-sky-500/20 text-sky-300 border-sky-500/40"
      : provenance.status === "estimated"
      ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
      : "bg-slate-600/30 text-slate-300 border-slate-500/40";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/70 backdrop-blur-sm">
      <aside className="flex h-full w-full max-w-lg flex-col border-l border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-sky-400">Data Provenance Inspector</div>
            <h2 className="text-base font-bold text-slate-100">
              {target.entityName} - {target.fieldLabel}
            </h2>
          </div>
          <button id="inspector.close_btn" type="button" onClick={onClose} aria-label="Close inspector" title="Close the Data Provenance Inspector drawer" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-sm">
          <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">Canonical SI Value</span>
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${badgeColor}`}>
                {provenance.status.replace(/_/g, " ").toUpperCase()}
              </span>
            </div>
            <div className="mt-1 text-xl font-bold text-slate-100">
              {String(provenance.value ?? "N/A")} <span className="text-sm font-normal text-slate-400">{provenance.canonical_unit}</span>
            </div>
            {provenance.notes && <p className="mt-2 text-xs text-slate-400">{provenance.notes}</p>}
          </div>

          <section className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">
              <BookOpen className="h-4 w-4" />
              <span>Section A: Verified Document Citation</span>
            </div>
            {provenance.citation ? (
              <div className="space-y-1.5 text-xs text-slate-300">
                <div><span className="text-slate-400">Document:</span> {provenance.citation.document_title}</div>
                {provenance.citation.author && <div><span className="text-slate-400">Author:</span> {provenance.citation.author}</div>}
                {provenance.citation.publisher && <div><span className="text-slate-400">Publisher:</span> {provenance.citation.publisher} ({provenance.citation.publication_year ?? "n.d."})</div>}
                {provenance.citation.page_number && <div><span className="text-slate-400">Reference:</span> Page {provenance.citation.page_number}{provenance.citation.table_or_figure ? `, ${provenance.citation.table_or_figure}` : ""}</div>}
                {provenance.citation.excerpt && (
                  <blockquote className="mt-2 rounded border-l-2 border-emerald-500 bg-slate-900 p-2 italic text-slate-300">
                    "{provenance.citation.excerpt}"
                  </blockquote>
                )}
                {provenance.citation.direct_url && (
                  <a id="inspector.citation_link" href={provenance.citation.direct_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 pt-1 text-sky-400 hover:underline">
                    <span>Open Primary Source</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-400">No direct primary citation attached; see mathematical derivation below.</p>
            )}
          </section>

          <section className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-400">
              <Calculator className="h-4 w-4" />
              <span>Section B: Derivation & Calculation Breakdown</span>
            </div>
            {provenance.derivation ? (
              <div className="space-y-2 text-xs text-slate-300">
                <div className="rounded bg-slate-900 p-2 font-mono text-sky-300">{provenance.derivation.governing_equation}</div>
                <div><span className="text-slate-400">Solver Method:</span> {provenance.derivation.solver_method}</div>
                <div><span className="text-slate-400">Confidence:</span> {provenance.derivation.confidence_rating.toUpperCase()}</div>
                <div>
                  <div className="text-slate-400 mb-1">Input Parameters:</div>
                  <div className="grid grid-cols-2 gap-1 rounded bg-slate-900 p-2 font-mono text-[11px]">
                    {Object.entries(provenance.derivation.input_parameters).map(([k, v]) => (
                      <div key={k}>{k} = {String(v)}</div>
                    ))}
                  </div>
                </div>
                {provenance.derivation.assumptions.length > 0 && (
                  <ul className="list-disc pl-4 text-slate-400">
                    {provenance.derivation.assumptions.map((a, idx) => (
                      <li key={idx}>{a}</li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-400">Value recorded directly from primary flight manual or user guide.</p>
            )}
          </section>

          <section className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-400">
              <ShieldCheck className="h-4 w-4" />
              <span>Section C: Confidence & Correction Proposal</span>
            </div>
            <div className="space-y-2">
              <input id="inspector.correction_value" type="text" value={correctedVal} onChange={(e) => setCorrectedVal(e.target.value)} placeholder={`Proposed ${provenance.canonical_unit} value`} className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100" />
              <textarea id="inspector.correction_rationale" rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Primary citation URL, page number, and justification" className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100" />
              <button id="inspector.submit_correction" type="button" onClick={() => { if (!correctedVal.trim()) return; onSubmitCorrection(target, correctedVal, rationale); setSubmittedMsg("Correction recorded in active session log."); setCorrectedVal(""); setRationale(""); }} title="Log a proposed source value correction and citation in the active session" className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500">
                Submit Correction
              </button>
              {submittedMsg && <div className="text-xs text-emerald-400">{submittedMsg}</div>}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
