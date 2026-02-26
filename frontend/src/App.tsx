import React, { useEffect, useState, useCallback } from "react";
import { fetchCurrentUser, fetchEtls, getToken, login, uploadEtl } from "./api";


// ─── Types ────────────────────────────────────────────────────────────────────


type Etl = {
 id: string;
 name: string;
 description: string;
 version: string;
 is_active: boolean;
 is_validated: boolean;
 created_at: string;
 zip_file?: string;
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
 status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "VALIDATION_FAILED";
 stdout_log?: string;
 stderr_log?: string;
 error_message?: string;
 launched_at: string;
 started_at?: string;
 completed_at?: string;
 return_code?: number;
};


type Notification = {
 id: string;
 level: "info" | "warning" | "error" | "success";
 title: string;
 message: string;
 is_read: boolean;
 created_at: string;
 etl_name?: string;
};


const API_BASE = "http://localhost:8000/api";


// ─── API helpers ──────────────────────────────────────────────────────────────


async function apiFetch(path: string, options: RequestInit = {}) {
 const token = getToken();
 const res = await fetch(`${API_BASE}${path}`, {
   ...options,
   headers: {
     Authorization: `Bearer ${token}`,
     ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
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


async function validateEtl(id: string) {
 return apiFetch(`/etls/${id}/validate/`, { method: "POST" });
}
async function activateEtl(id: string) {
 return apiFetch(`/etls/${id}/activate/`, { method: "POST" });
}
async function fetchExecutions(): Promise<Execution[]> {
 const data = await apiFetch("/executions/");
 if (Array.isArray(data)) return data;
 return data?.results ?? [];
}
async function createExecution(etlId: string, label: string) {
 return apiFetch("/executions/", {
   method: "POST",
   body: JSON.stringify({ etl: etlId, execution_label: label }),
 });
}
async function launchExecution(id: string) {
 return apiFetch(`/executions/${id}/launch/`, { method: "POST" });
}
async function fetchNotifications(): Promise<Notification[]> {
 const data = await apiFetch("/notifications/");
 if (Array.isArray(data)) return data;
 return data?.results ?? [];
}
async function markNotificationRead(id: string) {
 return apiFetch(`/notifications/${id}/`, {
   method: "PATCH",
   body: JSON.stringify({ is_read: true }),
 });
}
async function uploadInputFile(executionId: string, fileKey: string, file: File) {
 const fd = new FormData();
 fd.append("execution", executionId);
 fd.append("file_key", fileKey);
 fd.append("uploaded_file", file);
 return apiFetch("/input-files/", { method: "POST", body: fd });
}


// ─── Small UI primitives ──────────────────────────────────────────────────────


const STATUS_COLORS: Record<string, string> = {
 SUCCESS: "#22c55e",
 RUNNING: "#3b82f6",
 PENDING: "#f59e0b",
 FAILED: "#ef4444",
 VALIDATION_FAILED: "#ef4444",
};


function Badge({ label, color }: { label: string; color?: string }) {
 const bg = color ?? "#64748b";
 return (
   <span style={{
     display: "inline-block",
     padding: "2px 10px",
     borderRadius: 999,
     fontSize: 11,
     fontWeight: 600,
     letterSpacing: "0.04em",
     background: bg + "22",
     color: bg,
     border: `1px solid ${bg}44`,
     textTransform: "uppercase",
   }}>{label}</span>
 );
}


function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
 return (
   <div style={{
     background: "#ffffff",
     border: "1px solid #e2e8f0",
     borderRadius: 14,
     padding: 20,
     boxShadow: "0 2px 12px rgba(15,23,42,0.06)",
     ...style,
   }}>{children}</div>
 );
}


function Btn({
 children, onClick, variant = "primary", disabled, small, style
}: {
 children: React.ReactNode;
 onClick?: () => void;
 variant?: "primary" | "secondary" | "danger" | "success" | "ghost";
 disabled?: boolean;
 small?: boolean;
 style?: React.CSSProperties;
}) {
 const colors: Record<string, { bg: string; color: string; border: string }> = {
   primary:   { bg: "#0f172a", color: "#fff",     border: "#0f172a" },
   secondary: { bg: "#f1f5f9", color: "#0f172a",  border: "#e2e8f0" },
   danger:    { bg: "#fee2e2", color: "#b91c1c",  border: "#fca5a5" },
   success:   { bg: "#dcfce7", color: "#15803d",  border: "#86efac" },
   ghost:     { bg: "transparent", color: "#64748b", border: "#e2e8f0" },
 };
 const c = colors[variant];
 return (
   <button
     onClick={onClick}
     disabled={disabled}
     style={{
       padding: small ? "4px 12px" : "8px 16px",
       borderRadius: 8,
       border: `1px solid ${c.border}`,
       background: c.bg,
       color: c.color,
       fontWeight: 600,
       fontSize: small ? 12 : 13,
       cursor: disabled ? "not-allowed" : "pointer",
       opacity: disabled ? 0.6 : 1,
       transition: "opacity 0.15s",
       whiteSpace: "nowrap",
       ...style,
     }}
   >{children}</button>
 );
}


function SectionTitle({children, style}: { children: React.ReactNode, style?: any }) {
 return (
   <h2 style={{
     fontSize: 15,
     fontWeight: 700,
     color: "#0f172a",
     letterSpacing: "-0.01em",
     marginBottom: 16,
     paddingBottom: 10,
     borderBottom: "1px solid #f1f5f9",
   }}>{children}</h2>
 );
}


function EmptyState({ icon, text }: { icon: string; text: string }) {
 return (
   <div style={{ textAlign: "center", padding: "32px 0", color: "#94a3b8" }}>
     <div style={{ fontSize: 32, marginBottom: 8 }}>{icon}</div>
     <div style={{ fontSize: 13 }}>{text}</div>
   </div>
 );
}


// ─── Tabs ─────────────────────────────────────────────────────────────────────


function Tabs({
 tabs, active, onChange
}: { tabs: { id: string; label: string; badge?: number }[]; active: string; onChange: (id: string) => void }) {
 return (
   <div style={{ display: "flex", gap: 2, borderBottom: "1px solid #e2e8f0", marginBottom: 24 }}>
     {tabs.map(t => (
       <button
         key={t.id}
         onClick={() => onChange(t.id)}
         style={{
           padding: "10px 18px",
           fontSize: 13,
           fontWeight: 600,
           border: "none",
           background: "transparent",
           color: active === t.id ? "#0f172a" : "#94a3b8",
           cursor: "pointer",
           borderBottom: active === t.id ? "2px solid #0f172a" : "2px solid transparent",
           marginBottom: -1,
           display: "flex",
           alignItems: "center",
           gap: 6,
         }}
       >
         {t.label}
         {t.badge !== undefined && t.badge > 0 && (
           <span style={{
             background: "#ef4444",
             color: "#fff",
             borderRadius: 999,
             fontSize: 10,
             fontWeight: 700,
             padding: "1px 6px",
             minWidth: 16,
             textAlign: "center",
           }}>{t.badge}</span>
         )}
       </button>
     ))}
   </div>
 );
}


// ─── ETL Card (admin view) ─────────────────────────────────────────────────────


function EtlAdminCard({ etl, onRefresh }: { etl: Etl; onRefresh: () => void }) {
 const [busy, setBusy] = useState<string | null>(null);
 const [err, setErr] = useState<string | null>(null);


 async function handle(action: "validate" | "activate") {
   try {
     setBusy(action);
     setErr(null);
     if (action === "validate") await validateEtl(etl.id);
     else await activateEtl(etl.id);
     onRefresh();
   } catch (e: any) {
     setErr(e.message);
   } finally {
     setBusy(null);
   }
 }


 return (
   <Card style={{ marginBottom: 10 }}>
     <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
       <div>
         <div style={{ fontSize: 15, fontWeight: 600, color: "#0f172a" }}>{etl.name}</div>
         <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>v{etl.version} · {new Date(etl.created_at).toLocaleDateString()}</div>
         {etl.description && <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>{etl.description}</div>}
       </div>
       <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
         <Badge label={etl.is_validated ? "validated" : "not validated"} color={etl.is_validated ? "#22c55e" : "#94a3b8"} />
         <Badge label={etl.is_active ? "active" : "inactive"} color={etl.is_active ? "#3b82f6" : "#94a3b8"} />
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


// ─── Launch Execution Modal ───────────────────────────────────────────────────


function LaunchModal({ etl, onClose, onLaunched }: { etl: Etl; onClose: () => void; onLaunched: () => void }) {
 const [label, setLabel] = useState(`${etl.name} run`);
 const [inputFile, setInputFile] = useState<File | null>(null);
 const [fileKey, setFileKey] = useState("input");
 const [loading, setLoading] = useState(false);
 const [err, setErr] = useState<string | null>(null);


 async function submit() {
   try {
     setLoading(true);
     setErr(null);
     const exec = await createExecution(etl.id, label);
     if (inputFile) {
       await uploadInputFile(exec.id, fileKey, inputFile);
     }
     await launchExecution(exec.id);
     onLaunched();
     onClose();
   } catch (e: any) {
     setErr(e.message);
   } finally {
     setLoading(false);
   }
 }


 return (
   <div style={{
     position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)",
     display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100
   }}>
     <Card style={{ width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto" }}>
       <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
         <div style={{ fontSize: 16, fontWeight: 700 }}>Launch: {etl.name}</div>
         <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#94a3b8" }}>×</button>
       </div>


       <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>Execution label</label>
       <input
         value={label}
         onChange={e => setLabel(e.target.value)}
         style={inputStyle}
       />


       <div style={{ marginTop: 14 }}>
         <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>Input file (optional)</label>
         <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
           <input
             value={fileKey}
             onChange={e => setFileKey(e.target.value)}
             placeholder="file_key"
             style={{ ...inputStyle, maxWidth: 120, marginTop: 0 }}
           />
           <input
             type="file"
             onChange={e => setInputFile(e.target.files?.[0] ?? null)}
             style={{ fontSize: 13, flex: 1 }}
           />
         </div>
       </div>


       {err && <div style={{ marginTop: 12, fontSize: 12, color: "#ef4444", background: "#fee2e2", padding: 8, borderRadius: 6 }}>{err}</div>}


       <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
         <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
         <Btn disabled={loading || !label} onClick={submit}>{loading ? "Launching…" : "▶ Launch"}</Btn>
       </div>
     </Card>
   </div>
 );
}


// ─── Execution Log Modal ──────────────────────────────────────────────────────


function LogModal({ exec, onClose }: { exec: Execution; onClose: () => void }) {
 return (
   <div style={{
     position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)",
     display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100
   }}>
     <Card style={{ width: "100%", maxWidth: 680, maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
       <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
         <div>
           <div style={{ fontSize: 15, fontWeight: 700 }}>{exec.execution_label || exec.etl_name}</div>
           <div style={{ fontSize: 12, color: "#94a3b8" }}>
             {exec.launched_by_username} · {new Date(exec.launched_at).toLocaleString()}
           </div>
         </div>
         <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
           <Badge label={exec.status} color={STATUS_COLORS[exec.status]} />
           <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#94a3b8" }}>×</button>
         </div>
       </div>


       <div style={{ overflowY: "auto", flex: 1 }}>
         {exec.stdout_log && (
           <>
             <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 4 }}>STDOUT</div>
             <pre style={logStyle}>{exec.stdout_log}</pre>
           </>
         )}
         {exec.stderr_log && (
           <>
             <div style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", marginBottom: 4, marginTop: 12 }}>STDERR</div>
             <pre style={{ ...logStyle, borderColor: "#fca5a5", background: "#fff5f5" }}>{exec.stderr_log}</pre>
           </>
         )}
         {exec.error_message && (
           <>
             <div style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", marginBottom: 4, marginTop: 12 }}>ERROR</div>
             <pre style={{ ...logStyle, borderColor: "#fca5a5", background: "#fff5f5" }}>{exec.error_message}</pre>
           </>
         )}
         {!exec.stdout_log && !exec.stderr_log && !exec.error_message && (
           <EmptyState icon="📭" text="No logs yet." />
         )}
       </div>
     </Card>
   </div>
 );
}


const logStyle: React.CSSProperties = {
 background: "#0f172a",
 color: "#e2e8f0",
 borderRadius: 8,
 padding: 12,
 fontSize: 12,
 fontFamily: "monospace",
 whiteSpace: "pre-wrap",
 wordBreak: "break-all",
 border: "1px solid #1e293b",
 maxHeight: 260,
 overflowY: "auto",
};


const inputStyle: React.CSSProperties = {
 width: "100%",
 padding: "8px 10px",
 borderRadius: 8,
 border: "1px solid #e2e8f0",
 background: "#f8fafc",
 color: "#0f172a",
 fontSize: 13,
 marginTop: 6,
 boxSizing: "border-box",
};


// ─── Main App ─────────────────────────────────────────────────────────────────


function App() {
 const [username, setUsername] = useState("");
 const [password, setPassword] = useState("");
 const [isAuthenticated, setIsAuthenticated] = useState<boolean>(!!getToken());
 const [currentUser, setCurrentUser] = useState<User | null>(null);
 const [etls, setEtls] = useState<Etl[]>([]);
 const [executions, setExecutions] = useState<Execution[]>([]);
 const [notifications, setNotifications] = useState<Notification[]>([]);
 const [tab, setTab] = useState("etls");
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState<string | null>(null);


 // Upload form
 const [selectedFile, setSelectedFile] = useState<File | null>(null);
 const [name, setName] = useState("");
 const [description, setDescription] = useState("");
 const [version, setVersion] = useState("1.0");
 const [uploading, setUploading] = useState(false);


 // Modals
 const [launchEtl, setLaunchEtl] = useState<Etl | null>(null);
 const [logExec, setLogExec] = useState<Execution | null>(null);


 const unreadCount = notifications.filter(n => !n.is_read).length;


 const loadAll = useCallback(async () => {
   try {
     const [etlData, execData, notifData] = await Promise.all([
       fetchEtls(),
       fetchExecutions(),
       fetchNotifications(),
     ]);
     setEtls(Array.isArray(etlData) ? etlData : []);
     setExecutions(execData);
     setNotifications(notifData);
   } catch (e: any) {
     console.error(e);
   }
 }, []);


 useEffect(() => {
   if (isAuthenticated) {
     (async () => {
       try {
         const user = await fetchCurrentUser();
         setCurrentUser(user);
         await loadAll();
       } catch {
         setError("Could not load data.");
       }
     })();
   }
 }, [isAuthenticated]);


 async function handleLogin(e: React.FormEvent) {
   e.preventDefault();
   try {
     setError(null);
     await login(username, password);
     setIsAuthenticated(true);
   } catch {
     setError("Login failed. Check your credentials.");
   }
 }


 async function handleUpload(e: React.FormEvent) {
   e.preventDefault();
   if (!selectedFile || !name) return;
   const fd = new FormData();
   fd.append("name", name);
   fd.append("description", description);
   fd.append("version", version);
   fd.append("zip_file", selectedFile);
   try {
     setUploading(true);
     setError(null);
     await uploadEtl(fd);
     setName(""); setDescription(""); setVersion("1.0"); setSelectedFile(null);
     await loadAll();
   } catch (e: any) {
     setError("Upload failed: " + e.message);
   } finally {
     setUploading(false);
   }
 }


 function handleLogout() {
   localStorage.removeItem("access_token");
   setIsAuthenticated(false);
   setCurrentUser(null);
   setEtls([]); setExecutions([]); setNotifications([]);
 }


 // ── Login Screen ─────────────────────────────────────────────────────────────
 if (!isAuthenticated) {
   return (
     <div style={{
       minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
       background: "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)"
     }}>
       <form onSubmit={handleLogin} style={{
         width: "100%", maxWidth: 380, padding: 32,
         borderRadius: 16, background: "#fff",
         boxShadow: "0 20px 60px rgba(15,23,42,0.12)",
         border: "1px solid #e2e8f0"
       }}>
         <div style={{ marginBottom: 24 }}>
           <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "#94a3b8", textTransform: "uppercase", marginBottom: 6 }}>ETL Platform</div>
           <h1 style={{ fontSize: 26, fontWeight: 800, color: "#0f172a", margin: 0 }}>Sign in</h1>
         </div>


         {error && <div style={{ marginBottom: 16, padding: 10, borderRadius: 8, background: "#fee2e2", color: "#b91c1c", fontSize: 13 }}>{error}</div>}


         {["Username", "Password"].map((label, i) => (
           <div key={label} style={{ marginBottom: 14 }}>
             <label style={{ display: "block", marginBottom: 5, fontSize: 12, fontWeight: 600, color: "#64748b" }}>{label}</label>
             <input
               type={i === 1 ? "password" : "text"}
               value={i === 0 ? username : password}
               onChange={e => i === 0 ? setUsername(e.target.value) : setPassword(e.target.value)}
               style={inputStyle}
               required
             />
           </div>
         ))}


         <Btn style={{ width: "100%", justifyContent: "center" }}>Sign in →</Btn>
       </form>
     </div>
   );
 }


 // ── Active ETLs for user tab ──────────────────────────────────────────────────
 const activeEtls = etls.filter(e => e.is_active && e.is_validated);
 const isAdmin = currentUser?.is_admin ?? false;


 const tabs = [
   { id: "etls", label: isAdmin ? "Manage ETLs" : "Available ETLs" },
   ...(isAdmin ? [{ id: "upload", label: "Upload ETL" }] : []),
   { id: "executions", label: "Executions" },
   { id: "notifications", label: "Notifications", badge: unreadCount },
 ];


 // ── Main Layout ───────────────────────────────────────────────────────────────
 return (
   <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "system-ui, -apple-system, sans-serif" }}>
     {/* Header */}
     <div style={{
       background: "#ffffff", borderBottom: "1px solid #e2e8f0",
       padding: "0 24px", position: "sticky", top: 0, zIndex: 50,
       boxShadow: "0 1px 4px rgba(15,23,42,0.04)"
     }}>
       <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", height: 56 }}>
         <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
           <div style={{ width: 28, height: 28, borderRadius: 8, background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>⚡</div>
           <span style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" }}>ETL Platform</span>
         </div>
         <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
           <div style={{ fontSize: 13, color: "#64748b" }}>
             <span style={{ fontWeight: 600, color: "#0f172a" }}>{currentUser?.username}</span>
             {" · "}
             <Badge label={isAdmin ? "admin" : "user"} color={isAdmin ? "#8b5cf6" : "#3b82f6"} />
           </div>
           <Btn variant="ghost" small onClick={handleLogout}>Logout</Btn>
         </div>
       </div>
     </div>


     {/* Body */}
     <div style={{ maxWidth: 960, margin: "0 auto", padding: "28px 16px" }}>
       {error && (
         <div style={{ marginBottom: 16, padding: 10, borderRadius: 8, background: "#fee2e2", color: "#b91c1c", fontSize: 13, display: "flex", justifyContent: "space-between" }}>
           {error}
           <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#b91c1c", fontWeight: 700 }}>×</button>
         </div>
       )}


       <Tabs tabs={tabs} active={tab} onChange={setTab} />


       {/* ── ETLs Tab ─────────────────────────────────────────────────── */}
       {tab === "etls" && (
         <>
           {isAdmin ? (
             <>
               <SectionTitle>All ETLs ({etls.length})</SectionTitle>
               {etls.length === 0
                 ? <EmptyState icon="📦" text="No ETLs yet. Upload your first one." />
                 : etls.map(etl => <EtlAdminCard key={etl.id} etl={etl} onRefresh={loadAll} />)
               }
             </>
           ) : (
             <>
               <SectionTitle>Available ETLs ({activeEtls.length})</SectionTitle>
               {activeEtls.length === 0
                 ? <EmptyState icon="📭" text="No active ETLs yet. Contact an admin." />
                 : activeEtls.map(etl => (
                   <Card key={etl.id} style={{ marginBottom: 10 }}>
                     <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                       <div>
                         <div style={{ fontSize: 15, fontWeight: 600, color: "#0f172a" }}>{etl.name}</div>
                         <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>v{etl.version}</div>
                         {etl.description && <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>{etl.description}</div>}
                       </div>
                       <Btn onClick={() => setLaunchEtl(etl)}>▶ Launch</Btn>
                     </div>
                   </Card>
                 ))
               }
             </>
           )}
         </>
       )}


       {/* ── Upload Tab (admin only) ───────────────────────────────────── */}
       {tab === "upload" && isAdmin && (
         <Card>
           <SectionTitle>Upload new ETL (zip)</SectionTitle>
           <form onSubmit={handleUpload}>
             {[
               { label: "Name *", value: name, setter: setName, required: true },
               { label: "Version", value: version, setter: setVersion, required: false },
             ].map(({ label, value, setter, required }) => (
               <div key={label} style={{ marginBottom: 14 }}>
                 <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>{label}</label>
                 <input value={value} onChange={e => setter(e.target.value)} required={required} style={inputStyle} />
               </div>
             ))}


             <div style={{ marginBottom: 14 }}>
               <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>Description</label>
               <textarea
                 value={description}
                 onChange={e => setDescription(e.target.value)}
                 rows={3}
                 style={{ ...inputStyle, resize: "vertical" }}
               />
             </div>


             <div style={{ marginBottom: 20 }}>
               <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>ZIP File *</label>
               <div style={{ marginTop: 6 }}>
                 <input type="file" accept=".zip" onChange={e => setSelectedFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13 }} required />
               </div>
               <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>Expected: zip with main.py, config.json, requirements.txt</div>
             </div>


             <Btn disabled={uploading || !name || !selectedFile}>
               {uploading ? "Uploading…" : "Upload ETL"}
             </Btn>
           </form>
         </Card>
       )}


       {/* ── Executions Tab ───────────────────────────────────────────── */}
       {tab === "executions" && (
         <>
           <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
             <SectionTitle style={{ margin: 0, border: "none", padding: 0 } as any}>
               Executions ({executions.length})
             </SectionTitle>
             <Btn small variant="secondary" onClick={loadAll}>↻ Refresh</Btn>
           </div>


           {executions.length === 0
             ? <EmptyState icon="🚀" text="No executions yet." />
             : [...executions].sort((a, b) => new Date(b.launched_at).getTime() - new Date(a.launched_at).getTime()).map(exec => (
               <Card key={exec.id} style={{ marginBottom: 10 }}>
                 <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                   <div>
                     <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>{exec.execution_label || exec.etl_name}</div>
                     <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
                       {exec.etl_name} · {exec.launched_by_username} · {new Date(exec.launched_at).toLocaleString()}
                     </div>
                   </div>
                   <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                     <Badge label={exec.status} color={STATUS_COLORS[exec.status]} />
                     <Btn small variant="ghost" onClick={() => setLogExec(exec)}>View logs</Btn>
                   </div>
                 </div>
                 {exec.return_code !== undefined && exec.return_code !== null && (
                   <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>Exit code: {exec.return_code}</div>
                 )}
               </Card>
             ))
           }
         </>
       )}


       {/* ── Notifications Tab ────────────────────────────────────────── */}
       {tab === "notifications" && (
         <>
           <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
             <SectionTitle style={{ margin: 0, border: "none", padding: 0 } as any}>
               Notifications ({notifications.length})
             </SectionTitle>
             {unreadCount > 0 && (
               <Btn small variant="ghost" onClick={async () => {
                 await Promise.all(notifications.filter(n => !n.is_read).map(n => markNotificationRead(n.id)));
                 await loadAll();
               }}>Mark all read</Btn>
             )}
           </div>


           {notifications.length === 0
             ? <EmptyState icon="🔔" text="No notifications yet." />
             : [...notifications].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map(n => {
               const levelColor: Record<string, string> = { info: "#3b82f6", warning: "#f59e0b", error: "#ef4444", success: "#22c55e" };
               return (
                 <Card key={n.id} style={{ marginBottom: 10, opacity: n.is_read ? 0.6 : 1, borderLeft: `3px solid ${levelColor[n.level] ?? "#94a3b8"}` }}>
                   <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                     <div>
                       <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>
                         {!n.is_read && <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#3b82f6", marginRight: 6, verticalAlign: "middle" }} />}
                         {n.title}
                       </div>
                       <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>{n.message}</div>
                       <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>{new Date(n.created_at).toLocaleString()}</div>
                     </div>
                     <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                       <Badge label={n.level} color={levelColor[n.level]} />
                       {!n.is_read && (
                         <Btn small variant="ghost" onClick={async () => { await markNotificationRead(n.id); await loadAll(); }}>✓</Btn>
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
       <LaunchModal
         etl={launchEtl}
         onClose={() => setLaunchEtl(null)}
         onLaunched={() => { loadAll(); setTab("executions"); }}
       />
     )}
     {logExec && <LogModal exec={logExec} onClose={() => setLogExec(null)} />}
   </div>
 );
}


export default App;

