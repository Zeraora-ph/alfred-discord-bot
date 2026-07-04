const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path'); // Add path module
const execAsync = promisify(exec);

// Busca binário local
const ytDlpPath = path.resolve('yt-dlp.exe');

class YouTubeFallback {
    /**
     * Extrai URL de stream do YouTube usando yt-dlp
     * Usa quando Lavalink falha
     */
    async getStreamUrl(videoId) {
        try {
            // --print-json é melhor que --dump-json pois retorna apenas um objeto
            const { stdout } = await execAsync(
                `"${ytDlpPath}" -f "bestaudio/best" --get-url "https://www.youtube.com/watch?v=${videoId}"`
            );

            return stdout.trim();
        } catch (error) {
            throw new Error(`yt-dlp falhou: ${error.message}`);
        }
    }

    /**
     * Busca vídeo no YouTube
     */
    async search(query, limit = 5) {
        try {
            const { stdout } = await execAsync(
                `"${ytDlpPath}" "ytsearch${limit}:${query}" --dump-json --default-search "ytsearch"`
            );

            const results = stdout
                .trim()
                .split('\n')
                .filter(line => line)
                .map(line => {
                    try {
                        const data = JSON.parse(line);
                        return {
                            id: data.id,
                            title: data.title,
                            author: data.uploader || data.channel,
                            duration: (data.duration || 0) * 1000, // ms
                            url: `https://www.youtube.com/watch?v=${data.id}`,
                            thumbnail: data.thumbnail
                        };
                    } catch (e) {
                        return null;
                    }
                })
                .filter(r => r !== null);

            return results;
        } catch (error) {
            throw new Error(`Busca falhou: ${error.message}`);
        }
    }
}

module.exports = new YouTubeFallback();
