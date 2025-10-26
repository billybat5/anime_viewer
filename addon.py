from stremio_addon import addon, catalogs, metas, streams
from stremio_addon.server import run
import requests
from bs4 import BeautifulSoup
import base64
import re

LATANIME_URL = "https://latanime.org/"

MANIFEST = {
    "id": "community.python.latanime",
    "version": "1.0.0",
    "name": "LatAnime (Python)",
    "description": "Addon en Python para ver animes desde LatAnime.org",
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
    "idPrefixes": ["latanime:"]
}

class LatAnimeAddon(addon.Addon):
    def __init__(self):
        super(LatAnimeAddon, self).__init__(MANIFEST)

    @addon.handler(catalogs.Find)
    def find_catalogs(self, query, **kwargs):
        if query.type == 'series' and query.id == 'latanime-animes':
            try:
                response = requests.get(LATANIME_URL)
                response.raise_for_status()
                soup = BeautifulSoup(response.text, 'html.parser')
                
                meta_previews = []
                for article in soup.select('div.main-col article'):
                    title_tag = article.select_one('h3.title a')
                    poster_tag = article.select_one('div.poster img')
                    
                    if title_tag and poster_tag:
                        title = title_tag.text
                        link = title_tag['href']
                        poster = poster_tag['src']
                        
                        try:
                            slug = link.split('/')[-2]
                            meta_previews.append(metas.MetaPreview(
                                id="latanime:" + slug,
                                type="series",
                                name=title,
                                poster=poster
                            ))
                        except IndexError:
                            continue
                
                return catalogs.Catalog(meta_previews=meta_previews)
            except requests.exceptions.RequestException as e:
                print(f"Error fetching catalog: {e}")
                return None
        return None

    @addon.handler(metas.Find)
    def find_metas(self, query, **kwargs):
        if query.type == 'series' and query.id.startswith('latanime:'):
            slug = query.id.split(':')[1]
            anime_url = f"{LATANIME_URL}animes/{slug}"
            
            try:
                response = requests.get(anime_url)
                response.raise_for_status()
                soup = BeautifulSoup(response.text, 'html.parser')

                name = soup.select_one('h1.title').text
                poster = soup.select_one('div.poster img')['src']
                description = soup.select_one('div.sinopsis').text.strip()

                videos = []
                for li in soup.select('div.episodes li'):
                    link_tag = li.select_one('a')
                    if link_tag:
                        episode_link = link_tag['href']
                        episode_title = link_tag.text
                        
                        try:
                            episode_slug = episode_link.split('/')[-2]
                            episode_number_match = re.search(r'\d+$', episode_slug)
                            if episode_number_match:
                                episode_number = int(episode_number_match.group())
                                videos.append(metas.Video(
                                    id=f"latanime:{episode_slug}",
                                    title=episode_title,
                                    season=1,
                                    episode=episode_number,
                                    released="2024-01-01T00:00:00.000Z" # Placeholder
                                ))
                        except (IndexError, ValueError):
                            continue
                
                videos.reverse()

                meta_obj = metas.Meta(
                    id=query.id,
                    type='series',
                    name=name,
                    poster=poster,
                    description=description,
                    videos=videos
                )
                return [meta_obj]

            except requests.exceptions.RequestException as e:
                print(f"Error fetching meta: {e}")
                return []
        return []

    @addon.handler(streams.Find)
    def find_streams(self, query, **kwargs):
        if query.type == 'series' and query.id.startswith('latanime:'):
            episode_slug = query.id.split(':')[1]
            episode_url = f"{LATANIME_URL}ver/{episode_slug}"

            try:
                response = requests.get(episode_url)
                response.raise_for_status()
                soup = BeautifulSoup(response.text, 'html.parser')

                stream_results = []
                for a_tag in soup.select('a.play-video[data-player]'):
                    encoded_url = a_tag.get('data-player')
                    if encoded_url:
                        try:
                            decoded_url = base64.b64decode(encoded_url).decode('utf-8')
                            server_name = a_tag.text.strip()
                            stream_results.append(streams.Stream(
                                title=server_name,
                                url=decoded_url
                            ))
                        except (base64.binascii.Error, UnicodeDecodeError) as e:
                            print(f"Failed to decode base64 URL: {encoded_url}, {e}")
                
                return stream_results

            except requests.exceptions.RequestException as e:
                print(f"Error fetching streams: {e}")
                return []
        return []

if __name__ == '__main__':
    run(LatAnimeAddon())