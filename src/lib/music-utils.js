/**
 * 🎵 Music Utils
 * Utilitários para limpeza e preparação de links de música
 */

/**
 * Limpa URLs do YouTube removendo parâmetros de playlist/mix
 */
function cleanYoutubeUrl(url) {
    try {
        const urlObj = new URL(url);

        // Se for URL do YouTube, remove parâmetros de playlist
        if (urlObj.hostname.includes('youtube.com') || urlObj.hostname.includes('youtu.be')) {
            // Pega só o videoId
            const videoId = urlObj.searchParams.get('v');
            if (videoId) {
                return `https://www.youtube.com/watch?v=${videoId}`;
            }
        }

        return url;
    } catch {
        // Se não for URL válida, retorna como tá
        return url;
    }
}

/**
 * Detecta se é URL ou termo de busca
 */
function isUrl(str) {
    try {
        new URL(str);
        return true;
    } catch {
        return false;
    }
}

/**
 * Prepara a query pro Lavalink
 */
function prepareSearchQuery(input) {
    if (isUrl(input)) {
        return cleanYoutubeUrl(input);
    }

    // Se não for URL, faz busca no YouTube
    return `ytsearch:${input}`;
}

/**
 * Adapta uma Discord Interaction para a interface de Message esperada pelo MusicManager.
 * Permite que slash commands usem os mesmos métodos do MusicManager sem duplicar lógica.
 */
function buildMockMessage(interaction) {
    return {
        guild: interaction.guild,
        guildId: interaction.guildId,
        member: interaction.member,
        author: interaction.user,
        channel: interaction.channel,
        client: interaction.client,
        reply: (content) => {
            if (interaction.deferred || interaction.replied) {
                return interaction.editReply(content);
            }
            return interaction.reply(content);
        },
    };
}

module.exports = {
    cleanYoutubeUrl,
    isUrl,
    prepareSearchQuery,
    buildMockMessage
};
