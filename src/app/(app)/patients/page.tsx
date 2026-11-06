"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Patient = { id: string; full_name: string; birth_date: string | null; sex: string };
const sexLabel: Record<string, string> = { female: "Feminino", male: "Masculino", other: "Outro", not_informed: "Não informado" };

export default function Patients() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("Carregando pacientes…");
  useEffect(() => { void (async () => { try { const response = await fetch("/api/patients", { cache: "no-store" }); const body = await response.json().catch(() => null); if (!response.ok) { setMessage(response.status === 401 ? "Sua sessão expirou. Entre novamente." : body?.error ?? "Não foi possível carregar pacientes."); return; } setPatients(body?.data ?? []); setMessage(""); } catch { setMessage("Falha de rede ao carregar pacientes. Confirme que o servidor local está ativo."); } })(); }, []);
  const visible = useMemo(() => patients.filter((patient) => patient.full_name.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"))), [patients, query]);
  return <><div className="topline"><div><span className="eyebrow">Gestão clínica</span><h1>Pacientes</h1><p className="muted">Selecione um paciente para abrir seu prontuário individual.</p></div><Link className="button primary" href="/patients/new">Cadastrar paciente</Link></div><div className="card"><label className="label" htmlFor="search">Pesquisar paciente</label><input id="search" className="field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Digite um nome" />{message && <p className="notice" aria-live="polite">{message}</p>}<div style={{ display: "grid", gap: 10, marginTop: 16 }}>{visible.map((patient) => <Link className="card" key={patient.id} href={`/patients/${patient.id}`} style={{ textDecoration: "none", color: "inherit", margin: 0, border: "1px solid #cbd5e1", transition: "transform .15s, border-color .15s" }}><b>{patient.full_name}</b><br /><small className="muted">{patient.birth_date ? new Date(`${patient.birth_date}T00:00:00`).toLocaleDateString("pt-BR") : "Data de nascimento não informada"} · {sexLabel[patient.sex] ?? "Não informado"}</small><small style={{ display: "block", color: "#0b8078", marginTop: 8 }}>Abrir prontuário →</small></Link>)}{!message && !visible.length && <p className="muted">Nenhum paciente encontrado.</p>}</div></div></>;
}
