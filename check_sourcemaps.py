import urllib.request
import urllib.error
import re
import ssl

ssl._create_default_https_context = ssl._create_unverified_context

url = "https://agents-lab.fpt.ai/login"
try:
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    response = urllib.request.urlopen(req)
    html = response.read().decode('utf-8')
except urllib.error.HTTPError as e:
    html = e.read().decode('utf-8')
except Exception as e:
    print(f"Failed to fetch {url}: {e}")
    exit(1)

js_files = re.findall(r'(\w*static/chunks/[^"]+\.js)', html)
js_files += re.findall(r'(/_next/static/chunks/[^"]+\.js)', html)
js_files = list(set([j.strip('"\\') for j in js_files]))

print(f"Found {len(js_files)} JS files.")
print("Checking for exposed source maps (.map)...\n")

exposed_maps = []

for js in js_files:
    if not js.startswith('/_next/') and js.startswith('static/'):
        js_url = f"https://agents-lab.fpt.ai/_next/{js}"
    else:
        js_url = f"https://agents-lab.fpt.ai{js}" if js.startswith('/') else f"https://agents-lab.fpt.ai/{js}"
        
    map_url = js_url + ".map"
    
    try:
        req = urllib.request.Request(map_url, headers={'User-Agent': 'Mozilla/5.0'})
        response = urllib.request.urlopen(req)
        
        # If it didn't throw an HTTPError, it might be 200 OK. 
        # But we should also verify it's actually JSON, not a soft 404 HTML page.
        content = response.read(100).decode('utf-8', errors='ignore')
        if '{"version":' in content or '{"mappings":' in content:
            print(f"[+] FOUND SOURCE MAP: {map_url}")
            exposed_maps.append(map_url)
        else:
            # Maybe just a default HTML page returned
            pass
            
    except urllib.error.HTTPError as e:
        # 404 or 403 means not exposed
        pass
    except Exception as e:
        pass

if not exposed_maps:
    print("\n[-] No source maps were found to be exposed on this page.")
else:
    print(f"\n[!] WARNING: Found {len(exposed_maps)} exposed source maps!")
