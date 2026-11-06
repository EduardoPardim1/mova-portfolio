# Arquitetura e escopo da edição pública

Next.js usa App Router. Componentes React apresentam formulários e resultados; APIs verificam autenticação, membership e organização no servidor. O contexto mínimo rejeita seleção ambígua quando há múltiplos memberships sem seletor. PostgreSQL acrescenta RLS e integridade referencial.

As migrations 001–005 definem o schema inicial, bootstrap de autenticação, Storage e controles complementares. A 006 acrescenta integridade organizacional e imutabilidade; a 007 fornece salvamento atômico/idempotente; a 008 implementa relatórios privados com snapshot. Foram preservadas como código, não como autorização para executá-las em qualquer serviço. Requerem schemas e papéis de Supabase; não são um instalador autônomo de PostgreSQL puro.

O salvamento da avaliação não depende de duas inserções independentes da aplicação. Para PDF, o serviço separa preparação, upload e conclusão e não apresenta um objeto pendente como concluído. Testes de falhas e duplicidade pertencem à suíte pública, usando armazenamento simulado.

A análise de marcha e a TCN pequena permanecem experimentais. Nenhum peso treinado com eventos reais foi introduzido nesta publicação. A ferramenta `/dev/gait-annotation` permite revisão manual com lado, instante, quadro e incerteza. As rotas privadas exigem configuração e sessão; o portfólio não introduz bypass.

## O que foi deliberadamente excluído

Histórico Git antigo, TASKS interno, configurações reais, scripts de acesso/backup/hardening, consultas específicas de ambientes internos, logs, recibos, dumps, modelos, vídeos, landmarks e documentos com contatos pessoais. As notas públicas são sínteses dos resultados existentes, não reexecuções. A exclusão da cópia não apaga o original.

`research/event_comparison.py` é um recorte das funções próprias de comparação e adaptação já utilizadas. Os motores de terceiros, pesos, downloads e executores vinculados a arquivos privados não acompanham esse recorte. O teste Python original correspondente foi mantido, com importação redirecionada para o módulo público.
