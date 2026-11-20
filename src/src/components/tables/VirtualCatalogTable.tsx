import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpDown, Columns3, Filter, X } from "../common/Icons";

export type VisibilityState = Record<string, boolean>;

export interface ColumnDef<T, _V = unknown> {
  id: string;
  header: string;
  accessorFn: (row: T) => string | number | null | undefined;
  cell?: (ctx: { row: { original: T } }) => React.ReactNode;
}

export interface CatalogColumnGroup {
  group: string;
  columns: Array<{ id: string; label: string }>;
}

type FilterOp = "contains" | "equals" | "not_equals" | "gte" | "lte";

interface ActiveFilter {
  key: number;
  colId: string;
  op: FilterOp;
  value: string;
}

const OP_LABELS: Record<FilterOp, string> = {
  contains: "contains",
  equals: "equals",
  not_equals: "is not",
  gte: ">=",
  lte: "<=",
};

interface VirtualCatalogTableProps<T> {
  tableIdPrefix: string;
  data: T[];
  columns: ColumnDef<T, unknown>[];
  columnGroups: CatalogColumnGroup[];
  initialVisibility: VisibilityState;
}

function matchesFilter<T>(row: T, filter: ActiveFilter, col: ColumnDef<T, unknown>): boolean {
  const raw = col.accessorFn(row);
  const needle = filter.value.trim();
  if (needle === "") return true;
  if (filter.op === "gte" || filter.op === "lte") {
    const num = typeof raw === "number" ? raw : Number(raw);
    const lim = Number(needle);
    if (!Number.isFinite(num) || !Number.isFinite(lim)) return false;
    return filter.op === "gte" ? num >= lim : num <= lim;
  }
  const text = String(raw ?? "").toLowerCase();
  const target = needle.toLowerCase();
  if (filter.op === "contains") return text.includes(target);
  if (filter.op === "equals") return text === target;
  return text !== target;
}

export function VirtualCatalogTable<T>({
  tableIdPrefix,
  data,
  columns,
  columnGroups,
  initialVisibility,
}: VirtualCatalogTableProps<T>): React.ReactElement {
  const [sortColId, setSortColId] = useState<string | null>(null);
  const [sortDesc, setSortDesc] = useState<boolean>(false);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(initialVisibility);
  const [showPicker, setShowPicker] = useState<boolean>(false);
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [filters, setFilters] = useState<ActiveFilter[]>([]);
  const [draftCol, setDraftCol] = useState<string>(columns[0]?.id ?? "");
  const [draftOp, setDraftOp] = useState<FilterOp>("contains");
  const [draftValue, setDraftValue] = useState<string>("");
  const [scrollWidth, setScrollWidth] = useState<number>(0);
  const filterKeyRef = useRef<number>(0);
  const topBarRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const visibleColumns = useMemo(
    () => columns.filter((c) => columnVisibility[c.id] !== false),
    [columns, columnVisibility]
  );

  const filteredRows = useMemo(() => {
    if (filters.length === 0) return data;
    return data.filter((row) =>
      filters.every((f) => {
        const col = columns.find((c) => c.id === f.colId);
        return col ? matchesFilter(row, f, col) : true;
      })
    );
  }, [data, filters, columns]);

  const sortedRows = useMemo(() => {
    if (!sortColId) return filteredRows;
    const col = columns.find((c) => c.id === sortColId);
    if (!col) return filteredRows;
    const copy = [...filteredRows];
    copy.sort((a, b) => {
      const va = col.accessorFn(a);
      const vb = col.accessorFn(b);
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return sortDesc ? vb - va : va - vb;
      }
      const sa = String(va);
      const sb = String(vb);
      return sortDesc ? sb.localeCompare(sa) : sa.localeCompare(sb);
    });
    return copy;
  }, [filteredRows, columns, sortColId, sortDesc]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return undefined;
    const measure = (): void => setScrollWidth(el.scrollWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    const tbl = el.querySelector("table");
    if (tbl) observer.observe(tbl);
    return () => observer.disconnect();
  }, [visibleColumns.length, sortedRows.length]);

  const selectedFilterCol = useMemo(
    () => columns.find((c) => c.id === draftCol) ?? columns[0] ?? null,
    [columns, draftCol]
  );

  const distinctColValues = useMemo((): string[] => {
    if (!selectedFilterCol) return [];
    const nonNull = data
      .map((row) => selectedFilterCol.accessorFn(row))
      .filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
    const hasStrings = nonNull.some((v) => typeof v === "string");
    if (!hasStrings) return [];
    const unique = Array.from(new Set(nonNull.map((v) => String(v).trim())));
    if (unique.length === 0 || unique.length > 250) return [];
    return unique.sort((a, b) => a.localeCompare(b));
  }, [data, selectedFilterCol]);

  const isCategoricalFilter = distinctColValues.length > 0;

  const handleDraftColChange = (nextColId: string): void => {
    setDraftCol(nextColId);
    setDraftValue("");
    const col = columns.find((c) => c.id === nextColId);
    if (!col) return;
    const sample = data.find((r) => {
      const v = col.accessorFn(r);
      return v !== null && v !== undefined && String(v).trim() !== "";
    });
    const raw = sample ? col.accessorFn(sample) : null;
    if (typeof raw === "number") {
      setDraftOp("gte");
    } else {
      setDraftOp("equals");
    }
  };

  const handleTopScroll = (): void => {
    const top = topBarRef.current;
    const body = bodyRef.current;
    if (top && body && Math.abs(body.scrollLeft - top.scrollLeft) > 1) {
      body.scrollLeft = top.scrollLeft;
    }
  };

  const handleBodyScroll = (): void => {
    const top = topBarRef.current;
    const body = bodyRef.current;
    if (top && body && Math.abs(body.scrollLeft - top.scrollLeft) > 1) {
      top.scrollLeft = body.scrollLeft;
    }
  };

  const handleToggleSort = (colId: string): void => {
    if (sortColId === colId) {
      setSortDesc((prev) => !prev);
    } else {
      setSortColId(colId);
      setSortDesc(false);
    }
  };

  const handleToggleCol = (colId: string): void => {
    setColumnVisibility((prev) => ({
      ...prev,
      [colId]: prev[colId] === false,
    }));
  };

  const handleAddFilter = (): void => {
    if (!draftCol || draftValue.trim() === "") return;
    filterKeyRef.current += 1;
    setFilters((prev) => [
      ...prev,
      { key: filterKeyRef.current, colId: draftCol, op: draftOp, value: draftValue.trim() },
    ]);
    setDraftValue("");
  };

  const colHeader = (colId: string): string => columns.find((c) => c.id === colId)?.header ?? colId;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-slate-300">
          Showing {sortedRows.length} of {data.length} records across {visibleColumns.length} columns
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            data-testid="catalog.filter_btn"
            id={`${tableIdPrefix}.filter_btn`}
            type="button"
            title="Show or hide multi-column table filters."
            onClick={() => setShowFilters((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-800 ${
              showFilters || filters.length > 0 ? "border-sky-500 bg-sky-500/15" : "border-slate-600 bg-slate-900"
            }`}
          >
            <Filter className="h-3.5 w-3.5" />
            <span>Filters{filters.length > 0 ? ` (${filters.length})` : ""}</span>
          </button>
          <button
            data-testid="catalog.column_picker_btn"
            id={`${tableIdPrefix}.column_picker_btn`}
            type="button"
            title="Choose which telemetry columns are visible in the table."
            onClick={() => setShowPicker((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-800"
          >
            <Columns3 className="h-3.5 w-3.5" />
            <span>Columns ({visibleColumns.length})</span>
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900 p-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-300" title="Column to filter by.">
              Column
              <select
                id={`${tableIdPrefix}.filter_column`}
                value={draftCol}
                onChange={(e) => handleDraftColChange(e.target.value)}
                className="input-field mt-1 block text-xs"
              >
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.header}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-300" title="Comparison condition for the selected column.">
              Condition
              <select
                id={`${tableIdPrefix}.filter_op`}
                value={draftOp}
                onChange={(e) => setDraftOp(e.target.value as FilterOp)}
                className="input-field mt-1 block text-xs"
              >
                {(Object.keys(OP_LABELS) as FilterOp[]).map((op) => (
                  <option key={op} value={op}>
                    {OP_LABELS[op]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-300" title="Pick a definite catalog value or type a search value.">
              Value
              {isCategoricalFilter && (draftOp === "equals" || draftOp === "not_equals") ? (
                <select
                  id={`${tableIdPrefix}.filter_value`}
                  value={draftValue}
                  onChange={(e) => setDraftValue(e.target.value)}
                  className="input-field mt-1 block min-w-[12rem] text-xs"
                >
                  <option value="">-- Select value ({distinctColValues.length}) --</option>
                  {distinctColValues.map((val) => (
                    <option key={val} value={val}>
                      {val}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`${tableIdPrefix}.filter_value`}
                  type="text"
                  value={draftValue}
                  onChange={(e) => setDraftValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddFilter();
                  }}
                  placeholder={isCategoricalFilter ? "Type substring or switch to equals..." : "e.g. 5000"}
                  className="input-field mt-1 block w-48 text-xs"
                />
              )}
            </label>
            <button
              id={`${tableIdPrefix}.filter_add`}
              type="button"
              title="Apply this filter condition to the table."
              onClick={handleAddFilter}
              disabled={draftValue.trim() === ""}
              className="btn-primary px-3 py-2 text-xs disabled:opacity-50"
            >
              Add Filter
            </button>
            {filters.length > 0 && (
              <button
                id={`${tableIdPrefix}.filter_clear`}
                type="button"
                title="Remove all active filters and show every record."
                onClick={() => setFilters([])}
                className="btn-secondary px-3 py-2 text-xs"
              >
                Clear All
              </button>
            )}
          </div>
          {filters.length === 0 ? (
            <p className="text-xs text-slate-400">
              Pick any column to see definite dropdown values (Propellant, Power Cycle, Engine, Manufacturer, Country) or numeric thresholds (&gt;=, &lt;=).
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {filters.map((f) => (
                <span
                  key={f.key}
                  className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/50 bg-sky-500/15 py-1 pl-3 pr-1.5 text-xs text-sky-100"
                >
                  <span>
                    {colHeader(f.colId)} {OP_LABELS[f.op]} {f.value}
                  </span>
                  <button
                    type="button"
                    title={`Remove filter on ${colHeader(f.colId)}`}
                    aria-label={`Remove filter on ${colHeader(f.colId)}`}
                    onClick={() => setFilters((prev) => prev.filter((p) => p.key !== f.key))}
                    className="rounded-full p-1 hover:bg-sky-500/30"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {showPicker && (
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-700 bg-slate-900 p-3 text-xs md:grid-cols-3 lg:grid-cols-4">
          {columnGroups.map((grp) => (
            <div key={grp.group} className="space-y-1">
              <div className="font-semibold text-sky-300">{grp.group}</div>
              {grp.columns.map((colMeta) => (
                <label key={colMeta.id} className="flex cursor-pointer items-center gap-2 py-0.5 text-slate-200">
                  <input
                    data-testid="catalog.col_toggle"
                    type="checkbox"
                    checked={columnVisibility[colMeta.id] !== false}
                    onChange={() => handleToggleCol(colMeta.id)}
                    className="h-4 w-4"
                  />
                  <span>{colMeta.label}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
      )}

      <div
        ref={topBarRef}
        onScroll={handleTopScroll}
        className="w-full overflow-x-scroll rounded border border-slate-800 bg-slate-900/60"
        style={{ height: 16 }}
        aria-label="Horizontal table scroll bar"
      >
        <div style={{ width: scrollWidth, height: 1 }} />
      </div>

      <div
        ref={bodyRef}
        onScroll={handleBodyScroll}
        className="max-h-[620px] overflow-auto rounded-lg border border-slate-700 bg-slate-950"
      >
        {sortedRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-300">
            No records match the current filters. Remove a filter or press Clear All to see everything again.
          </div>
        ) : (
          <table className="w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 z-20 border-b border-slate-700 bg-slate-900 text-slate-100">
              <tr>
                {visibleColumns.map((col, idx) => (
                  <th
                    key={col.id}
                    className={`whitespace-nowrap border-r border-slate-800 px-3 py-2.5 font-semibold ${
                      idx === 0 ? "sticky-col-head" : ""
                    }`}
                  >
                    <button
                      data-testid="catalog.sort_col" title="Sort catalog table by this column (ascending, descending, or default)"
                      type="button"
                      onClick={() => handleToggleSort(col.id)}
                      className="inline-flex items-center gap-1 hover:text-sky-300"
                    >
                      <span>{col.header}</span>
                      <ArrowUpDown className={`h-3 w-3 ${sortColId === col.id ? "text-sky-300" : "text-slate-400"}`} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, rowIdx) => (
                <tr key={rowIdx} className="border-b border-slate-800 hover:bg-slate-900/60">
                  {visibleColumns.map((col, idx) => (
                    <td
                      key={col.id}
                      className={`whitespace-nowrap border-r border-slate-800 px-3 py-2 text-slate-100 ${
                        idx === 0 ? "sticky-col-cell" : ""
                      }`}
                    >
                      {col.cell ? col.cell({ row: { original: row } }) : String(col.accessorFn(row) ?? "--")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
