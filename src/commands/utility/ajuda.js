const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ajuda')
    .setDescription('Mostra a lista de comandos e o que eles fazem.'),
  
  async execute(message) {
    const helpText = `**🤖 Alfred - Comandos Disponíveis:**\n\n**Comandos Principais:**\n\n• \`/pergunta [texto]\` — Pergunte qualquer coisa para a IA\n• \`/resumo [URL]\` — Resume o conteúdo de uma página da web\n• \`/traduzir [idioma] [texto]\` — Traduz texto para outro idioma\n• \`/ajuda\` — Mostra esta mensagem de ajuda\n• \`/status\` — Mostra o status do provedor de IA e APIs\n• \`/teste [api]\` — Testa uma API específica ou todas\n\n**Comandos de Música:**\n\n• \`/play [música]\` — Toca músicas do YouTube/Spotify\n• \`/pause\` — Pausa a música\n• \`/skip\` — Pula para a próxima música\n• \`/queue\` — Mostra a fila de músicas\n• \`/leave\` — Faz o bot sair do canal de voz\n\n**Comandos de APIs Externas:**\n\n• \`/tempo [cidade]\` — Previsão do tempo (OpenWeatherMap)\n• \`/pesquisar [termo]\` — Pesquisa no Google\n• \`/musica [artista ou música]\` — Info de música/artista (Last.fm)\n• \`/cidade [nome]\` — Info geográfica (GeoNames)\n• \`/filme [nome]\` — Info de filme (OMDb)\n\n**Dica:**\nVocê pode mencionar o Alfred e pedir direto, por exemplo:\n• \`alfred toque Queen\`\n• \`alfred tempo em São Paulo\`\n• \`alfred filme Matrix\`\n\nPara gerenciar permissões de memória, acesse o painel web do Alfred.\n`;
    await message.reply(helpText);
  }
}; 