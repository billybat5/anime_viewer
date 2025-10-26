const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const LATANIME_URL = "https://latanime.org/";

// Manifest
const manifest = {
    "id": "community.stremio.latanime",
    "version": "1.0.0",
    "name": "LatAnime",
    "description": "Addon para ver animes desde LatAnime.org",
    "resources": [
        "catalog",
        "meta",
        "stream"
    ],
    "types": ["series"],
    "catalogs": [
        {
            "type": "series",
            "id": "latanime-animes",
            "name": "Animes"
        }
    ],
    "idPrefixes": [ "latanime:" ]
};

const builder = new addonBuilder(manifest);

// Catalog Handler
builder.defineCatalogHandler(async ({type, id, extra}) => {
    console.log("Request for catalog: " + type + " " + id);
    let metas = [];

    if (type === 'series' && id === 'latanime-animes') {
        try {
            const response = await axios.get(LATANIME_URL);
            const $ = cheerio.load(response.data);

            $('div.main-col article').each((i, element) => {
                const title = $(element).find('h3.title a').text();
                const poster = $(element).find('div.poster img').attr('src');
                const link = $(element).find('h3.title a').attr('href');

                // Extraer el slug de la URL para usarlo como ID
                const urlParts = link.split('/');
                const slug = urlParts[urlParts.length - 2];

                if (title && poster && slug) {
                    metas.push({
                        id: "latanime:" + slug,
                        type: "series",
                        name: title,
                        poster: poster
                    });
                }
            });
        } catch (error) {
            console.error("Error fetching catalog:", error);
            // Devolver un catálogo vacío en caso de error
            return Promise.resolve({ metas: [] });
        }
    }

    return Promise.resolve({ metas: metas });
});

// Meta Handler
builder.defineMetaHandler(async ({type, id}) => {
    console.log("Request for meta: " + type + " " + id);

    const [prefix, slug] = id.split(':');
    const animeUrl = `${LATANIME_URL}animes/${slug}`;

    try {
        const response = await axios.get(animeUrl);
        const $ = cheerio.load(response.data);

        const name = $('h1.title').text();
        const poster = $('div.poster img').attr('src');
        const synopsis = $('div.sinopsis').text().trim();
        
        const videos = [];
        $('div.episodes li').each((i, element) => {
            const episodeLink = $(element).find('a').attr('href');
            const episodeTitle = $(element).find('a').text();
            
            const episodeUrlParts = episodeLink.split('/');
            const episodeSlug = episodeUrlParts[episodeUrlParts.length - 2];
            const episodeNumber = parseInt(episodeSlug.match(/\d+$/)[0], 10);

            if (episodeSlug && !isNaN(episodeNumber)) {
                videos.push({
                    id: `latanime:${episodeSlug}`,
                    title: episodeTitle,
                    season: 1, // LatAnime doesn't seem to have season numbers, so we'll default to 1
                    episode: episodeNumber,
                    released: new Date() // Placeholder for release date
                });
            }
        });

        // Reverse the videos array so that episode 1 is first
        const meta = {
            id: id,
            type: 'series',
            name: name,
            poster: poster,
            synopsis: synopsis,
            videos: videos.reverse()
        };

        return Promise.resolve({ meta: meta });

    } catch (error) {
        console.error("Error fetching meta:", error);
        return Promise.reject(new Error("Failed to get meta for " + id));
    }
});


// Stream Handler
builder.defineStreamHandler(async ({type, id}) => {
    console.log("Request for streams: " + type + " " + id);

    const [prefix, episodeSlug] = id.split(':');
    const episodeUrl = `${LATANIME_URL}ver/${episodeSlug}`;

    try {
        const { data } = await axios.get(episodeUrl);
        const $ = cheerio.load(data);

        let streams = [];

        // --- METHOD 1: Find the `var video = [...]` script block ---
        const scriptContent = $('script:contains("var video =")').html();
        if (scriptContent) {
            const videoArrayMatch = scriptContent.match(/var video = (\s*[^;]+);/);
            if (videoArrayMatch && videoArrayMatch[1]) {
                const videoArrayStr = videoArrayMatch[1];
                const urlRegex = /file:\s*"(.*?)"/g;
                let match;
                while ((match = urlRegex.exec(videoArrayStr)) !== null) {
                    streams.push({
                        title: "Server (JS)",
                        url: match[1]
                    });
                }
            }
        }

        // --- METHOD 2: Use the Player API if Method 1 fails ---
        if (streams.length === 0) {
            const dataId = $('div#Player').attr('data-id');
            if (dataId) {
                console.log("Falling back to API method with data-id:", dataId);
                // We need to send the data as application/x-www-form-urlencoded
                const params = new URLSearchParams();
                params.append('id', dataId);

                const apiResponse = await axios.post(`${LATANIME_URL}api/player/`, params);
                
                if (apiResponse.data && apiResponse.data.player) {
                    const playerHtml = apiResponse.data.player;
                    const $ = cheerio.load(playerHtml);
                    $('iframe').each((i, el) => {
                        const streamUrl = $(el).attr('src');
                        if (streamUrl) {
                            streams.push({
                                title: "Server (API)",
                                url: streamUrl
                            });
                        }
                    });
                }
            }
        }

        if (streams.length === 0) {
            throw new Error("No stream URLs found on page: " + episodeUrl);
        }

        return Promise.resolve({ streams: streams });

    } catch (error) {
        console.error("Error fetching streams:", error);
        return Promise.reject(new Error("Failed to get streams for " + id));
    }
});

module.exports = builder.getInterface();