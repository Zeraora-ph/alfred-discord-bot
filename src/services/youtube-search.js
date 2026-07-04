/**
 * 🎵 YouTube Data API v3 Search Service
 * 
 * Provides more accurate music search using the official YouTube API
 * with filtering by category (Music), duration, and channel quality.
 */

const { google } = require('googleapis');
const logger = require('../lib/logger');

// Initialize YouTube API client
const apiKey = process.env.YOUTUBE_API_KEY;
let youtube = null;

if (apiKey) {
    youtube = google.youtube({
        version: 'v3',
        auth: apiKey
    });
    logger.info('[YouTube API] Cliente inicializado com sucesso');
} else {
    logger.warn('[YouTube API] YOUTUBE_API_KEY não configurada, usando fallback');
}

/**
 * Search for music videos using YouTube Data API
 * 
 * @param {string} query - Search query (song/artist name)
 * @param {number} maxResults - Maximum results to return (default: 5)
 * @returns {Promise<Array>} Array of video results
 */
async function searchMusic(query, maxResults = 5) {
    if (!youtube) {
        logger.warn('[YouTube API] API não disponível, retornando vazio');
        return [];
    }

    try {
        // Add "official audio" suffix to prioritize official versions
        const searchQuery = query.toLowerCase().includes('cover')
            ? query
            : `${query} official audio`;

        logger.info(`[YouTube API] Buscando: "${searchQuery}"`);

        const response = await youtube.search.list({
            q: searchQuery,
            part: 'snippet',
            type: 'video',
            maxResults: maxResults,
            order: 'relevance',
            videoCategoryId: '10', // Music category
            regionCode: 'BR',
            relevanceLanguage: 'pt'
        });

        if (!response.data.items || response.data.items.length === 0) {
            logger.warn('[YouTube API] Nenhum resultado encontrado');
            return [];
        }

        // Get video details (duration, view count) for better filtering
        const videoIds = response.data.items.map(item => item.id.videoId).join(',');

        const detailsResponse = await youtube.videos.list({
            id: videoIds,
            part: 'contentDetails,statistics'
        });

        const detailsMap = new Map();
        for (const video of detailsResponse.data.items || []) {
            detailsMap.set(video.id, {
                duration: parseDuration(video.contentDetails?.duration),
                viewCount: parseInt(video.statistics?.viewCount || '0')
            });
        }

        // Build results with additional info
        const results = response.data.items.map(item => {
            const details = detailsMap.get(item.id.videoId) || { duration: 0, viewCount: 0 };
            return {
                id: item.id.videoId,
                url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
                title: item.snippet.title,
                channel: item.snippet.channelTitle,
                thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
                duration: details.duration,
                durationRaw: formatDuration(details.duration),
                viewCount: details.viewCount,
                publishedAt: item.snippet.publishedAt
            };
        });

        // Filter by duration (typical song: 2-10 minutes)
        const filtered = results.filter(r => {
            // Skip very short (<1min) or very long (>15min) videos
            if (r.duration < 60 || r.duration > 900) return false;
            return true;
        });

        // Sort by view count (popularity) as tiebreaker
        filtered.sort((a, b) => b.viewCount - a.viewCount);

        logger.info(`[YouTube API] Encontrados ${filtered.length} resultados filtrados`);
        return filtered.length > 0 ? filtered : results;

    } catch (error) {
        if (error.code === 403) {
            logger.error('[YouTube API] Quota excedida ou API Key inválida');
        } else {
            logger.error(`[YouTube API] Erro na busca: ${error.message}`);
        }
        return [];
    }
}

/**
 * Parse YouTube duration format (PT3M45S) to seconds
 */
function parseDuration(duration) {
    if (!duration) return 0;

    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;

    const hours = parseInt(match[1] || 0);
    const minutes = parseInt(match[2] || 0);
    const seconds = parseInt(match[3] || 0);

    return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Format seconds to MM:SS or HH:MM:SS
 */
function formatDuration(seconds) {
    if (!seconds) return '??:??';

    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    if (h > 0) {
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Extract playlist ID from various YouTube URL formats
 */
function extractPlaylistId(url) {
    // Handle various formats:
    // - https://www.youtube.com/playlist?list=PLxxxxxx
    // - https://www.youtube.com/watch?v=xxx&list=PLxxxxxx
    // - https://music.youtube.com/playlist?list=PLxxxxxx
    const match = url.match(/[?&]list=([^&]+)/);
    return match ? match[1] : null;
}

/**
 * Get all videos from a YouTube playlist using Data API
 * 
 * @param {string} playlistUrl - Full playlist URL or playlist ID
 * @param {number} maxItems - Maximum items to fetch (default: 50)
 * @returns {Promise<Object>} Playlist info with videos array
 */
async function getPlaylistItems(playlistUrl, maxItems = 50) {
    if (!youtube) {
        logger.warn('[YouTube API] API não disponível para playlists');
        return null;
    }

    try {
        // Extract playlist ID from URL
        const playlistId = extractPlaylistId(playlistUrl) || playlistUrl;

        if (!playlistId) {
            logger.error('[YouTube API] Não foi possível extrair ID da playlist');
            return null;
        }

        logger.info(`[YouTube API] Buscando playlist: ${playlistId}`);

        // Get playlist metadata first
        const playlistResponse = await youtube.playlists.list({
            id: playlistId,
            part: 'snippet,contentDetails'
        });

        if (!playlistResponse.data.items || playlistResponse.data.items.length === 0) {
            logger.warn('[YouTube API] Playlist não encontrada');
            return null;
        }

        const playlistData = playlistResponse.data.items[0];
        const playlistTitle = playlistData.snippet.title;
        const totalCount = playlistData.contentDetails.itemCount;

        logger.info(`[YouTube API] Playlist "${playlistTitle}" - ${totalCount} itens`);

        // Get playlist items (videos)
        const videos = [];
        let nextPageToken = null;

        while (videos.length < maxItems) {
            const itemsResponse = await youtube.playlistItems.list({
                playlistId: playlistId,
                part: 'snippet,contentDetails',
                maxResults: Math.min(50, maxItems - videos.length),
                pageToken: nextPageToken
            });

            if (!itemsResponse.data.items) break;

            for (const item of itemsResponse.data.items) {
                const videoId = item.contentDetails.videoId;
                if (!videoId) continue;

                videos.push({
                    id: videoId,
                    url: `https://www.youtube.com/watch?v=${videoId}`,
                    title: item.snippet.title,
                    channel: { name: item.snippet.videoOwnerChannelTitle || 'Desconhecido' },
                    thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
                    durationRaw: '??:??', // Will be filled when playing
                    position: item.snippet.position
                });
            }

            nextPageToken = itemsResponse.data.nextPageToken;
            if (!nextPageToken) break;
        }

        logger.info(`[YouTube API] Carregados ${videos.length} vídeos da playlist`);

        return {
            id: playlistId,
            title: playlistTitle,
            videoCount: totalCount,
            videos: videos
        };

    } catch (error) {
        if (error.code === 403) {
            logger.error('[YouTube API] Quota excedida ou playlist privada');
        } else if (error.code === 404) {
            logger.error('[YouTube API] Playlist não encontrada');
        } else {
            logger.error(`[YouTube API] Erro ao buscar playlist: ${error.message}`);
        }
        return null;
    }
}

/**
 * Check if YouTube API is available
 */
function isAvailable() {
    return youtube !== null;
}

module.exports = {
    searchMusic,
    getPlaylistItems,
    extractPlaylistId,
    isAvailable,
    parseDuration,
    formatDuration
};
