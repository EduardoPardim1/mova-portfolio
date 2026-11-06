# Revisão da edição pública — 06/11/2026

**Aprovada para publicar código de portfólio; não aprovada para deploy ou uso clínico.**

## Seleção e segurança

A cópia tem histórico novo. Todos os arquivos selecionados são texto UTF-8; foram examinados integralmente por padrões de credenciais, chaves privadas, JWT, endereços, caminhos e identificadores internos, com revisão dos resultados e comparação em memória com os segredos locais configurados. Não foram encontrados valores reais de credenciais, dados de pacientes, referências ao ambiente interno ou contatos privados na seleção. Os e-mails e UUIDs das fixtures são sintéticos; o caminho C:/video.mp4 é uma entrada fictícia de teste de rejeição, não um caminho pessoal.

Código de aplicação e oito migrations preservados byte a byte na preparação. Os testes de banco operacional, backup, ambiente remoto e aquisição de datasets foram excluídos porque dependem de materiais não publicados. A documentação pública foi escrita separadamente, com métricas agregadas. Arquivos de terceiros, mídia, binários, logs, snapshots e histórico antigo não foram importados. A revisão é evidência de controle de publicação, não garantia absoluta nem certificação de segurança comercial.

## Verificações executadas na cópia

| Verificação | Resultado |
|---|---|
| Instalação pelo lockfile | npm ci --ignore-scripts aprovado |
| Typecheck | aprovado |
| Lint | aprovado, sem avisos |
| Vitest | 285 testes aprovados, 31 arquivos |
| Python | 14 testes aprovados |
| Build Next.js | aprovado |

Ambiente: Node.js 24.15.0, npm 11.12.1, Python 3.14.5. Uma importação MethodType omitida ao extrair o módulo Python foi corrigida; os 14 testes passaram na repetição. Nenhum algoritmo foi alterado. Os 442 testes históricos do projeto privado não são apresentados como contagem desta edição.

## Dependências

npm audit retornou 14 pacotes afetados: quatro críticos, três altos e sete moderados, incluindo ferramentas de desenvolvimento. Não foi executado npm audit fix nem atualização major automática. A instalação e o build funcionaram; isso não elimina vulnerabilidades.

| Pacote | Versão fixada | Severidade informada | Contexto |
|---|---|---|---|
| dompurify | 2.5.9 | high | runtime |
| jspdf | 2.5.2 | critical | runtime |
| next | 15.5.27 | critical | runtime |
| postcss | 8.4.31 | high | build/testes |
| tinypool | 1.1.1 | critical | build/testes |
| vitest | 3.2.7 | critical | build/testes |
| zod | 3.25.76 | high | runtime |

Triagem de alcance: o PDF usa texto e fontes internas; não foi encontrado uso de loadFile, html, addImage ou AcroForm com entrada externa no renderizador. Isso reduz o alcance direto do [aviso de inclusão de arquivos jsPDF](https://github.com/advisories/GHSA-f8cm-6447-x5h2), mas não elimina outros avisos. O [aviso de otimização de imagem Next.js](https://github.com/advisories/GHSA-2464-fhr4-w9xw) descreve condições específicas de execução em Linux; este ensaio ocorreu no Windows e não testou exploração. Vitest/tinypool estão no ambiente de desenvolvimento, sem servidor de testes exposto. Zod valida entradas de APIs, exigindo revisão de limites e atualização antes de eventual serviço público. Não expor esta versão à rede.

As correções sugeridas para parte da árvore exigem versões major. Não foram adotadas sem avaliação de regressões, especialmente do renderer PDF versionado e dos contratos. Os alertas não são credenciais expostas e não impedem, por si sós, a publicação transparente do código para estudo.

## Direitos e limites da reprodução

Somente código próprio, schemas e fixtures sintéticas selecionadas. Licenças de dependências permanecem com seus autores; veja [NOTICE](../NOTICE.md). Não há mídia acadêmica nem peso de modelo no Git. As conclusões científicas agregadas não permitem reproduzir os ensaios privados sem dados autorizados e suas referências. Nenhum teste Supabase remoto, atendimento, treinamento ou novo experimento foi realizado nesta publicação.
