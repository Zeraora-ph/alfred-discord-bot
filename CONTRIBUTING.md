# Como Contribuir para o Alfred Bot

Ficamos muito felizes pelo seu interesse em contribuir com o Alfred Bot! Este documento serve para orientar o processo de contribuição, garantindo que o projeto continue organizado e eficiente.

## Código de Conduta

Ao participar deste projeto, você concorda em manter uma comunicação respeitosa, construtiva e inclusiva com todos os outros desenvolvedores e usuários.

## Como Posso Contribuir?

### Relatando Bugs

Se você encontrar um problema ou comportamento inesperado no bot:
1. Verifique se o bug já foi relatado pesquisando nas **Issues** do GitHub.
2. Caso não encontre, crie uma nova Issue detalhando:
   - Uma descrição clara e objetiva do problema.
   - Passos passo a passo para reproduzir o bug.
   - O comportamento esperado vs. o comportamento observado.
   - Logs de erro ou prints relevantes (sem expor chaves de API ou dados pessoais).

### Sugerindo Melhorias

Sugestões de novas funcionalidades são sempre bem-vindas:
1. Crie uma Issue para discutir a ideia antes de começar a codificar. Isso ajuda a alinhar a proposta com a visão geral do projeto.
2. Explique detalhadamente qual problema a nova feature resolve e como ela se comportaria.

### Enviando Pull Requests (PRs)

Se você decidiu implementar uma melhoria ou correção:
1. Faça um **Fork** do repositório.
2. Crie uma branch para a sua feature/correção (`git checkout -b feature/minha-melhoria`).
3. Certifique-se de que o código segue o padrão existente do projeto.
4. Adicione testes unitários se aplicável.
5. Certifique-se de rodar a suíte de testes (`npm run test:unit`) e verificar se tudo passa.
6. Faça commit das suas alterações com mensagens claras e concisas.
7. Faça o push para o seu fork e abra um **Pull Request** apontando para a branch principal.

## Padrões de Código

- Escreva código limpo, legível e bem comentado.
- Remova `console.log` de debug temporários ou desnecessários.
- Certifique-se de usar tratamento de erros adequado (try-catch, tratamento de rejeições).
- Nunca faça commit de arquivos `.env` ou chaves privadas.

## Contato

Se tiver dúvidas, sinta-se à vontade para abrir uma Issue ou entrar em contato com os mantenedores.
