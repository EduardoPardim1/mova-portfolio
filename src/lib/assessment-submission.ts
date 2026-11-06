/** Uma intenção de salvamento por análise; sem gravar dados pessoais em localStorage ou disco. */
export function createAssessmentSubmission(transport: typeof fetch = fetch) {
  const requestId = crypto.randomUUID();
  type Receipt = { assessmentId: string; replayed: boolean };
  let pending: Promise<Receipt> | undefined;
  let pendingBody: string | undefined;
  let confirmed: { body: string; receipt: Receipt } | undefined;
  return {
    save(payload: unknown): Promise<Receipt> {
      const serialized = JSON.stringify(payload);
      if (confirmed) return confirmed.body === serialized ? Promise.resolve(confirmed.receipt)
        : Promise.reject(new Error("Esta análise já foi salva. Inicie uma nova avaliação para outro registro."));
      if (pending) return pendingBody === serialized ? pending
        : Promise.reject(new Error("Aguarde a confirmação do envio em andamento."));
      pendingBody = serialized;
      pending = (async () => {
        let response: Response;
        try {
          response = await transport("/api/assessments", { method: "POST", headers: {
            "content-type": "application/json", "Idempotency-Key": requestId,
          }, body: serialized });
        } catch { throw new Error("Falha de rede. Tente salvar novamente; a chave deste envio será preservada."); }
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Não foi possível confirmar o salvamento.");
        if (body?.requestId !== requestId || typeof body?.replayed !== "boolean"
          || typeof body?.data?.id !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.data.id)) {
          throw new Error("Resposta sem confirmação válida. Repita o mesmo envio antes de iniciar outra avaliação.");
        }
        const receipt = { assessmentId: body.data.id as string, replayed: body.replayed as boolean };
        confirmed = { body: serialized, receipt };
        return receipt;
      })().finally(() => { pending = undefined; pendingBody = undefined; });
      return pending;
    },
  };
}
