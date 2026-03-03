import React, { useEffect, useState, useCallback } from "react";
import { fetchCurrentUser, fetchEtls, getToken, login, uploadEtl } from "./api";

// ─── Types ────────────────────────────────────────────────────────────────────

type InputSpec = {
  required?: boolean;
  extensions?: string[];
  description?: string;
};

type EtlConfig = {
  entry_point?: string;
  input_requirements?: Record<string, InputSpec>;
  expected_outputs?: string[];
};

type Etl = {
  id: string;
  name: string;
  description: string;
  version: string;
  is_active: boolean;
  is_validated: boolean;
  created_at: string;
  config?: EtlConfig;
};

type User = {
  id: number;
  username: string;
  role: "admin" | "user";
  is_admin: boolean;
};

type Execution = {
  id: string;
  etl: string;
  etl_name: string;
  execution_label: string;
  launched_by: number;
  launched_by_username: string;
  status: string;
  stdout_log?: string;
  stderr_log?: string;
  error_message?: string;
  launched_at: string;
  completed_at?: string;
  return_code?: number;
};

type OutputFile = {
  id: string;
  execution: string;
  filename: string;
  file_path: string;
  file_size: number;
  file_type: string;
  created_at: string;
  download_count: number;
};

type Notification = {
  id: string;
  level: "info" | "warning" | "error" | "success";
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

const API_BASE = "http://localhost:8000/api";

// ─── API ──────────────────────────────────────────────────────────────────────

async function apiFetch(path: string, options: RequestInit = {}) {
  const token = getToken();
  const isFormData = options.body instanceof FormData;
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(!isFormData ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const api = {
  validateEtl: (id: string) => apiFetch(`/etls/${id}/validate/`, { method: "POST" }),
  activateEtl: (id: string) => apiFetch(`/etls/${id}/activate/`, { method: "POST" }),
  fetchExecutions: async (): Promise<Execution[]> => {
    const d = await apiFetch("/executions/");
    return Array.isArray(d) ? d : d?.results ?? [];
  },
  createExecution: (etlId: string, label: string) =>
    apiFetch("/executions/", { method: "POST", body: JSON.stringify({ etl: etlId, execution_label: label }) }),
  launchExecution: (id: string) => apiFetch(`/executions/${id}/launch/`, { method: "POST" }),
  fetchOutputFiles: async (): Promise<OutputFile[]> => {
    const d = await apiFetch("/output-files/");
    return Array.isArray(d) ? d : d?.results ?? [];
  },
  uploadInputFile: (executionId: string, fileKey: string, file: File) => {
    const fd = new FormData();
    fd.append("execution", executionId);
    fd.append("file_key", fileKey);
    fd.append("uploaded_file", file);
    return apiFetch("/input-files/", { method: "POST", body: fd });
  },
  fetchNotifications: async (): Promise<Notification[]> => {
    const d = await apiFetch("/notifications/");
    return Array.isArray(d) ? d : d?.results ?? [];
  },
  markRead: (id: string) =>
    apiFetch(`/notifications/${id}/`, { method: "PATCH", body: JSON.stringify({ is_read: true }) }),
};

// ─── Tiny UI primitives ───────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  SUCCESS: "#16a34a", RUNNING: "#2563eb", INSTALLING_DEPS: "#7c3aed",
  PENDING: "#d97706", FAILED: "#dc2626", VALIDATION_FAILED: "#dc2626",
  VALIDATED: "#0891b2", VALIDATING: "#0891b2",
};

function Badge({ label, color }: { label: string; color?: string }) {
  const c = color ?? "#64748b";
  return (
    <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 999, fontSize: 11,
      fontWeight: 700, letterSpacing: "0.05em", background: c + "18", color: c,
      border: `1px solid ${c}30`, textTransform: "uppercase" as const }}>
      {label}
    </span>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12,
      padding: 18, boxShadow: "0 1px 8px rgba(15,23,42,0.05)", ...style }}>
      {children}
    </div>
  );
}

function Btn({ children, onClick, variant = "primary", disabled, small, style }: {
  children: React.ReactNode; onClick?: () => void;
  variant?: "primary"|"secondary"|"danger"|"success"|"ghost";
  disabled?: boolean; small?: boolean; style?: React.CSSProperties;
}) {
  const C = { primary: ["#0f172a","#fff","#0f172a"], secondary: ["#f1f5f9","#0f172a","#e2e8f0"],
    danger: ["#fee2e2","#b91c1c","#fca5a5"], success: ["#dcfce7","#15803d","#86efac"],
    ghost: ["transparent","#64748b","#e2e8f0"] }[variant];
  return (
    <button onClick={onClick} disabled={disabled} style={{ padding: small ? "4px 11px" : "8px 16px",
      borderRadius: 8, border: `1px solid ${C[2]}`, background: C[0], color: C[1],
      fontWeight: 600, fontSize: small ? 12 : 13, cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.55 : 1, whiteSpace: "nowrap" as const, ...style }}>
      {children}
    </button>
  );
}

const inputCss: React.CSSProperties = { width: "100%", padding: "7px 10px", borderRadius: 8,
  border: "1px solid #e2e8f0", background: "#f8fafc", color: "#0f172a", fontSize: 13,
  marginTop: 5, boxSizing: "border-box" as const };

function SectionTitle({children, style}: { children: React.ReactNode, style?: any }) {
  return <h2 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", letterSpacing: "-0.01em",
    marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid #f1f5f9" }}>{children}</h2>;
}

function Empty({ icon, text }: { icon: string; text: string }) {
  return <div style={{ textAlign: "center", padding: "28px 0", color: "#94a3b8" }}>
    <div style={{ fontSize: 28, marginBottom: 6 }}>{icon}</div>
    <div style={{ fontSize: 13 }}>{text}</div>
  </div>;
}

function Tabs({ tabs, active, onChange }: {
  tabs: { id: string; label: string; badge?: number }[];
  active: string; onChange: (id: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 2, borderBottom: "1px solid #e2e8f0", marginBottom: 22 }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)} style={{ padding: "9px 16px", fontSize: 13,
          fontWeight: 600, border: "none", background: "transparent",
          color: active === t.id ? "#0f172a" : "#94a3b8", cursor: "pointer",
          borderBottom: active === t.id ? "2px solid #0f172a" : "2px solid transparent",
          marginBottom: -1, display: "flex", alignItems: "center", gap: 5 }}>
          {t.label}
          {!!t.badge && t.badge > 0 && (
            <span style={{ background: "#ef4444", color: "#fff", borderRadius: 999,
              fontSize: 10, fontWeight: 700, padding: "1px 6px" }}>{t.badge}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Launch Modal (with dynamic input fields from config) ─────────────────────

function LaunchModal({ etl, onClose, onDone }: { etl: Etl; onClose: () => void; onDone: () => void }) {
  const inputReqs = etl.config?.input_requirements ?? {};
  const [label, setLabel] = useState(`${etl.name} — ${new Date().toLocaleDateString()}`);
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState<"form" | "running">("form");
  const [progress, setProgress] = useState("");

  function setFile(key: string, file: File | null) {
    setFiles(f => ({ ...f, [key]: file }));
  }

  // Check all required inputs are provided
  const missingRequired = Object.entries(inputReqs)
    .filter(([k, spec]) => spec.required && !files[k])
    .map(([k]) => k);

  async function submit() {
    try {
      setLoading(true); setErr(null); setStep("running");

      setProgress("Creating execution…");
      const exec = await api.createExecution(etl.id, label);

      // Upload each provided input file
      for (const [key, file] of Object.entries(files)) {
        if (file) {
          setProgress(`Uploading ${key}…`);
          await api.uploadInputFile(exec.id, key, file);
        }
      }

      setProgress("Launching ETL…");
      await api.launchExecution(exec.id);

      onDone();
      onClose();
    } catch (e: any) {
      setErr(e.message);
      setStep("form");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <Card style={{ width: "100%", maxWidth: 500, maxHeight: "90vh", overflowY: "auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Launch ETL</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{etl.name} v{etl.version}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20,
            cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>×</button>
        </div>

        {step === "running" ? (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>⚙️</div>
            <div style={{ fontSize: 14, color: "#0f172a", fontWeight: 600 }}>{progress}</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>Please wait…</div>
          </div>
        ) : (
          <>
            {/* Execution label */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>Execution label</label>
              <input value={label} onChange={e => setLabel(e.target.value)} style={inputCss} />
            </div>

            {/* Dynamic input files from config */}
            {Object.keys(inputReqs).length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b",
                  marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Input files
                </div>
                {Object.entries(inputReqs).map(([key, spec]) => (
                  <div key={key} style={{ marginBottom: 12, padding: 12, borderRadius: 8,
                    border: "1px solid #e2e8f0", background: "#f8fafc" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{key}</span>
                      {spec.required
                        ? <Badge label="required" color="#dc2626" />
                        : <Badge label="optional" color="#64748b" />}
                      {spec.extensions && (
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>
                          {spec.extensions.join(", ")}
                        </span>
                      )}
                    </div>
                    {spec.description && (
                      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>{spec.description}</div>
                    )}
                    <input
                      type="file"
                      accept={spec.extensions?.join(",") ?? undefined}
                      onChange={e => setFile(key, e.target.files?.[0] ?? null)}
                      style={{ fontSize: 12, width: "100%" }}
                    />
                    {files[key] && (
                      <div style={{ fontSize: 11, color: "#16a34a", marginTop: 4 }}>
                        ✓ {files[key]!.name} ({(files[key]!.size / 1024).toFixed(1)} KB)
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* No inputs needed */}
            {Object.keys(inputReqs).length === 0 && (
              <div style={{ padding: 12, borderRadius: 8, background: "#f0fdf4",
                border: "1px solid #86efac", fontSize: 13, color: "#15803d", marginBottom: 14 }}>
                ✓ This ETL requires no input files.
              </div>
            )}

            {err && (
              <div style={{ marginBottom: 12, padding: 10, borderRadius: 8,
                background: "#fee2e2", color: "#b91c1c", fontSize: 13 }}>
                {err}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
              <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
              <Btn
                disabled={loading || !label || missingRequired.length > 0}
                onClick={submit}
              >
                {missingRequired.length > 0
                  ? `Missing: ${missingRequired.join(", ")}`
                  : "▶ Launch"}
              </Btn>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

// ─── Log Modal ────────────────────────────────────────────────────────────────

function LogModal({ exec, onClose }: { exec: Execution; onClose: () => void }) {
  const logStyle: React.CSSProperties = { background: "#0f172a", color: "#e2e8f0",
    borderRadius: 8, padding: 12, fontSize: 12, fontFamily: "monospace",
    whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 220, overflowY: "auto",
    border: "1px solid #1e293b", marginTop: 6 };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <Card style={{ width: "100%", maxWidth: 680, maxHeight: "88vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{exec.execution_label || exec.etl_name}</div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>
              {exec.launched_by_username} · {new Date(exec.launched_at).toLocaleString()}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Badge label={exec.status} color={STATUS_COLOR[exec.status]} />
            <button onClick={onClose} style={{ background: "none", border: "none",
              fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>×</button>
          </div>
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {exec.stdout_log && <>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>STDOUT</div>
            <pre style={logStyle}>{exec.stdout_log}</pre>
          </>}
          {exec.stderr_log && <>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", marginTop: 12 }}>STDERR</div>
            <pre style={{ ...logStyle, borderColor: "#fca5a5", background: "#1c0a0a" }}>{exec.stderr_log}</pre>
          </>}
          {exec.error_message && <>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", marginTop: 12 }}>ERROR</div>
            <pre style={{ ...logStyle, borderColor: "#fca5a5", background: "#1c0a0a" }}>{exec.error_message}</pre>
          </>}
          {!exec.stdout_log && !exec.stderr_log && !exec.error_message && (
            <Empty icon="📭" text="No logs yet." />
          )}
        </div>
      </Card>
    </div>
  );
}

// ─── Output Files Panel ───────────────────────────────────────────────────────

function OutputsPanel({ executionId, execLabel }: { executionId: string; execLabel: string }) {
  const [outputs, setOutputs] = useState<OutputFile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.fetchOutputFiles().then(all => {
      setOutputs(all.filter(o => o.execution === executionId));
      setLoading(false);
    });
  }, [executionId]);

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  if (loading) return <div style={{ fontSize: 12, color: "#94a3b8" }}>Loading outputs…</div>;
  if (outputs.length === 0) return <div style={{ fontSize: 12, color: "#94a3b8" }}>No output files.</div>;

  return (
    <div style={{ marginTop: 10 }}>
      {outputs.map(o => (
        <div key={o.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "8px 12px", borderRadius: 8, border: "1px solid #e2e8f0",
          background: "#f8fafc", marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>📄 {o.filename}</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>
              {o.file_type.toUpperCase()} · {formatSize(o.file_size)}
              {o.download_count > 0 && ` · downloaded ${o.download_count}×`}
            </div>
          </div>
          <a
            href={`${API_BASE}/output-files/${o.id}/download/`}
            download={o.filename}
            onClick={async () => {
              // Use auth header for download
              try {
                const token = getToken();
                const res = await fetch(`${API_BASE}/output-files/${o.id}/download/`, {
                  headers: { Authorization: `Bearer ${token}` },
                });
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url; a.download = o.filename; a.click();
                URL.revokeObjectURL(url);
              } catch { /* fallback to direct link */ }
            }}
            style={{ textDecoration: "none" }}
          >
            <Btn small variant="success">⬇ Download</Btn>
          </a>
        </div>
      ))}
    </div>
  );
}

// ─── ETL Admin Card ───────────────────────────────────────────────────────────

function EtlAdminCard({ etl, onRefresh }: { etl: Etl; onRefresh: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  async function handle(action: "validate" | "activate") {
    try { setBusy(action); setErr(null);
      if (action === "validate") await api.validateEtl(etl.id);
      else await api.activateEtl(etl.id);
      onRefresh();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(null); }
  }

  const inputReqs = etl.config?.input_requirements ?? {};
  const expectedOutputs = etl.config?.expected_outputs ?? [];

  return (
    <Card style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start",
        flexWrap: "wrap", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{etl.name}</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
            v{etl.version} · {new Date(etl.created_at).toLocaleDateString()}
            {etl.config?.entry_point && ` · entry: ${etl.config.entry_point}`}
          </div>
          {etl.description && <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>{etl.description}</div>}

          {/* Config summary */}
          {etl.config && Object.keys(etl.config).length > 0 && (
            <button onClick={() => setShowConfig(s => !s)}
              style={{ background: "none", border: "none", cursor: "pointer",
                fontSize: 12, color: "#64748b", marginTop: 6, padding: 0 }}>
              {showConfig ? "▲ Hide config" : "▼ Show config"}
            </button>
          )}
          {showConfig && (
            <div style={{ marginTop: 8 }}>
              {Object.keys(inputReqs).length > 0 && (
                <div style={{ fontSize: 12, color: "#475569", marginBottom: 4 }}>
                  <strong>Inputs:</strong> {Object.entries(inputReqs).map(([k, s]) =>
                    `${k}${s.required ? "*" : ""}`).join(", ")}
                </div>
              )}
              {expectedOutputs.length > 0 && (
                <div style={{ fontSize: 12, color: "#475569" }}>
                  <strong>Expected outputs:</strong> {expectedOutputs.join(", ")}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <Badge label={etl.is_validated ? "validated" : "not validated"}
            color={etl.is_validated ? "#16a34a" : "#94a3b8"} />
          <Badge label={etl.is_active ? "active" : "inactive"}
            color={etl.is_active ? "#2563eb" : "#94a3b8"} />
          {!etl.is_validated && (
            <Btn small variant="secondary" disabled={!!busy} onClick={() => handle("validate")}>
              {busy === "validate" ? "…" : "✓ Validate"}
            </Btn>
          )}
          {etl.is_validated && !etl.is_active && (
            <Btn small variant="success" disabled={!!busy} onClick={() => handle("activate")}>
              {busy === "activate" ? "…" : "▶ Activate"}
            </Btn>
          )}
        </div>
      </div>
      {err && <div style={{ marginTop: 8, fontSize: 12, color: "#ef4444" }}>{err}</div>}
    </Card>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

function App() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(!!getToken());
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [etls, setEtls] = useState<Etl[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [tab, setTab] = useState("etls");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Upload form state
  const [uploadName, setUploadName] = useState("");
  const [uploadDesc, setUploadDesc] = useState("");
  const [uploadVersion, setUploadVersion] = useState("1.0");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  // Modals
  const [launchEtl, setLaunchEtl] = useState<Etl | null>(null);
  const [logExec, setLogExec] = useState<Execution | null>(null);
  const [outputExec, setOutputExec] = useState<Execution | null>(null);

  const unread = notifications.filter(n => !n.is_read).length;
  const isAdmin = currentUser?.is_admin ?? false;

  const loadAll = useCallback(async () => {
    const [etlData, execData, notifData] = await Promise.allSettled([
      fetchEtls(), api.fetchExecutions(), api.fetchNotifications(),
    ]);
    if (etlData.status === "fulfilled") setEtls(Array.isArray(etlData.value) ? etlData.value : []);
    if (execData.status === "fulfilled") setExecutions(execData.value);
    if (notifData.status === "fulfilled") setNotifications(notifData.value);
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchCurrentUser().then(setCurrentUser).catch(() => {});
      loadAll();
    }
  }, [isAuthenticated]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    try {
      setError(null);
      const { login: loginFn } = await import("./api");
      await loginFn(username, password);
      setIsAuthenticated(true);
    } catch { setError("Login failed. Check credentials."); }
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile || !uploadName) return;
    const fd = new FormData();
    fd.append("name", uploadName); fd.append("description", uploadDesc);
    fd.append("version", uploadVersion); fd.append("zip_file", uploadFile);
    try {
      setUploading(true); setError(null);
      await uploadEtl(fd);
      setUploadName(""); setUploadDesc(""); setUploadVersion("1.0"); setUploadFile(null);
      await loadAll();
    } catch (e: any) { setError("Upload failed: " + e.message); }
    finally { setUploading(false); }
  }

  function handleLogout() {
    localStorage.removeItem("access_token");
    setIsAuthenticated(false); setCurrentUser(null);
  }

  // ── Login ──────────────────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center",
        justifyContent: "center", background: "linear-gradient(135deg,#f8fafc,#e2e8f0)" }}>
        <form onSubmit={handleLogin} style={{ width: "100%", maxWidth: 370, padding: 32,
          borderRadius: 16, background: "#fff", boxShadow: "0 20px 60px rgba(15,23,42,0.12)",
          border: "1px solid #e2e8f0" }}>
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8",
              letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 4 }}>ETL Platform</div>
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: "#0f172a" }}>Sign in</h1>
          </div>
          {error && <div style={{ marginBottom: 14, padding: 10, borderRadius: 8,
            background: "#fee2e2", color: "#b91c1c", fontSize: 13 }}>{error}</div>}
          {["Username","Password"].map((lbl, i) => (
            <div key={lbl} style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>{lbl}</label>
              <input type={i === 1 ? "password" : "text"} required style={inputCss}
                value={i === 0 ? username : password}
                onChange={e => i === 0 ? setUsername(e.target.value) : setPassword(e.target.value)} />
            </div>
          ))}
          <Btn style={{ width: "100%" }}>Sign in →</Btn>
        </form>
      </div>
    );
  }

  // ── Main layout ────────────────────────────────────────────────────────────
  const activeEtls = etls.filter(e => e.is_active && e.is_validated);

  const tabs = [
    { id: "etls",   label: isAdmin ? "Manage ETLs" : "Available ETLs" },
    ...(isAdmin ? [{ id: "upload", label: "Upload ETL" }] : []),
    { id: "executions",    label: "Executions" },
    { id: "notifications", label: "Notifications", badge: unread },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc",
      fontFamily: "system-ui,-apple-system,sans-serif" }}>

      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0",
        padding: "0 20px", position: "sticky", top: 0, zIndex: 50,
        boxShadow: "0 1px 3px rgba(15,23,42,0.04)" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex",
          justifyContent: "space-between", alignItems: "center", height: 54 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 26, height: 26, borderRadius: 7, background: "#0f172a",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>⚡</div>
            <span style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>ETL Platform</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, color: "#64748b" }}>
              <strong style={{ color: "#0f172a" }}>{currentUser?.username}</strong>
              {" · "}
              <Badge label={isAdmin ? "admin" : "user"} color={isAdmin ? "#7c3aed" : "#2563eb"} />
            </span>
            <Btn small variant="ghost" onClick={handleLogout}>Logout</Btn>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "26px 16px" }}>
        {error && (
          <div style={{ marginBottom: 14, padding: 10, borderRadius: 8,
            background: "#fee2e2", color: "#b91c1c", fontSize: 13,
            display: "flex", justifyContent: "space-between" }}>
            {error}
            <button onClick={() => setError(null)}
              style={{ background: "none", border: "none", cursor: "pointer", fontWeight: 700, color: "#b91c1c" }}>×</button>
          </div>
        )}

        <Tabs tabs={tabs} active={tab} onChange={setTab} />

        {/* ── ETLs ─────────────────────────────────────────────────────── */}
        {tab === "etls" && isAdmin && (
          <>
            <SectionTitle>All ETLs ({etls.length})</SectionTitle>
            {etls.length === 0
              ? <Empty icon="📦" text="No ETLs yet. Upload one above." />
              : etls.map(e => <EtlAdminCard key={e.id} etl={e} onRefresh={loadAll} />)}
          </>
        )}

        {tab === "etls" && !isAdmin && (
          <>
            <SectionTitle>Available ETLs ({activeEtls.length})</SectionTitle>
            {activeEtls.length === 0
              ? <Empty icon="📭" text="No ETLs available yet. Contact an admin." />
              : activeEtls.map(etl => (
                <Card key={etl.id} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between",
                    alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>{etl.name}</div>
                      <div style={{ fontSize: 12, color: "#94a3b8" }}>v{etl.version}</div>
                      {etl.description && <div style={{ fontSize: 13, color: "#475569", marginTop: 3 }}>{etl.description}</div>}
                      {/* Show what inputs are needed */}
                      {etl.config?.input_requirements && Object.keys(etl.config.input_requirements).length > 0 && (
                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                          Needs: {Object.entries(etl.config.input_requirements).map(([k, s]) =>
                            <span key={k} style={{ marginRight: 6 }}>
                              <Badge label={k} color={s.required ? "#dc2626" : "#64748b"} />
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <Btn onClick={() => setLaunchEtl(etl)}>▶ Launch</Btn>
                  </div>
                </Card>
              ))
            }
          </>
        )}

        {/* ── Upload ───────────────────────────────────────────────────── */}
        {tab === "upload" && isAdmin && (
          <Card>
            <SectionTitle>Upload new ETL (zip)</SectionTitle>
            <form onSubmit={handleUpload}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>Name *</label>
                <input value={uploadName} onChange={e => setUploadName(e.target.value)} required style={inputCss} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>Description</label>
                <textarea value={uploadDesc} onChange={e => setUploadDesc(e.target.value)}
                  rows={3} style={{ ...inputCss, resize: "vertical" }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>Version</label>
                <input value={uploadVersion} onChange={e => setUploadVersion(e.target.value)}
                  style={{ ...inputCss, maxWidth: 120 }} />
              </div>
              <div style={{ marginBottom: 18 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>ZIP file *</label>
                <div style={{ marginTop: 5 }}>
                  <input type="file" accept=".zip" required
                    onChange={e => setUploadFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13 }} />
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                  Include main.py, config.json (with input_requirements), requirements.txt
                </div>
              </div>
              <Btn disabled={uploading || !uploadName || !uploadFile}>
                {uploading ? "Uploading…" : "Upload ETL"}
              </Btn>
            </form>
          </Card>
        )}

        {/* ── Executions ───────────────────────────────────────────────── */}
        {tab === "executions" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between",
              alignItems: "center", marginBottom: 14 }}>
              <SectionTitle style={{ margin: 0, border: "none", padding: 0 } as any}>
                Executions ({executions.length})
              </SectionTitle>
              <Btn small variant="secondary" onClick={loadAll}>↻ Refresh</Btn>
            </div>
            {executions.length === 0
              ? <Empty icon="🚀" text="No executions yet." />
              : [...executions]
                  .sort((a, b) => new Date(b.launched_at).getTime() - new Date(a.launched_at).getTime())
                  .map(exec => (
                  <Card key={exec.id} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between",
                      alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>
                          {exec.execution_label || exec.etl_name}
                        </div>
                        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
                          {exec.etl_name} · {exec.launched_by_username} · {new Date(exec.launched_at).toLocaleString()}
                          {exec.completed_at && ` → ${new Date(exec.completed_at).toLocaleTimeString()}`}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <Badge label={exec.status} color={STATUS_COLOR[exec.status]} />
                        <Btn small variant="ghost" onClick={() => setLogExec(exec)}>📋 Logs</Btn>
                        {exec.status === "SUCCESS" && (
                          <Btn small variant="success" onClick={() => setOutputExec(exec)}>⬇ Outputs</Btn>
                        )}
                      </div>
                    </div>
                  </Card>
                ))
            }
          </>
        )}

        {/* ── Notifications ────────────────────────────────────────────── */}
        {tab === "notifications" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between",
              alignItems: "center", marginBottom: 14 }}>
              <SectionTitle style={{ margin: 0, border: "none", padding: 0 } as any}>
                Notifications ({notifications.length})
              </SectionTitle>
              {unread > 0 && (
                <Btn small variant="ghost" onClick={async () => {
                  await Promise.all(notifications.filter(n => !n.is_read).map(n => api.markRead(n.id)));
                  await loadAll();
                }}>Mark all read</Btn>
              )}
            </div>
            {notifications.length === 0
              ? <Empty icon="🔔" text="No notifications yet." />
              : [...notifications]
                  .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                  .map(n => {
                    const lc: Record<string, string> = { info:"#2563eb", warning:"#d97706", error:"#dc2626", success:"#16a34a" };
                    return (
                      <Card key={n.id} style={{ marginBottom: 8, opacity: n.is_read ? 0.55 : 1,
                        borderLeft: `3px solid ${lc[n.level] ?? "#94a3b8"}` }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 600 }}>
                              {!n.is_read && <span style={{ display: "inline-block", width: 6, height: 6,
                                borderRadius: "50%", background: "#3b82f6", marginRight: 6, verticalAlign: "middle" }} />}
                              {n.title}
                            </div>
                            <div style={{ fontSize: 13, color: "#475569", marginTop: 3 }}>{n.message}</div>
                            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 5 }}>
                              {new Date(n.created_at).toLocaleString()}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <Badge label={n.level} color={lc[n.level]} />
                            {!n.is_read && (
                              <Btn small variant="ghost" onClick={async () => { await api.markRead(n.id); await loadAll(); }}>✓</Btn>
                            )}
                          </div>
                        </div>
                      </Card>
                    );
                  })
            }
          </>
        )}
      </div>

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {launchEtl && (
        <LaunchModal etl={launchEtl} onClose={() => setLaunchEtl(null)}
          onDone={() => { loadAll(); setTab("executions"); }} />
      )}
      {logExec && <LogModal exec={logExec} onClose={() => setLogExec(null)} />}
      {outputExec && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <Card style={{ width: "100%", maxWidth: 520 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>
                Output files — {outputExec.execution_label || outputExec.etl_name}
              </div>
              <button onClick={() => setOutputExec(null)}
                style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>×</button>
            </div>
            <OutputsPanel executionId={outputExec.id} execLabel={outputExec.execution_label} />
          </Card>
        </div>
      )}
    </div>
  );
}

export default App;