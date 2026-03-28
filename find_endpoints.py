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
    # Read the body of the 500 response anyway
    html = e.read().decode('utf-8')
except Exception as e:
    print(f"Failed to fetch {url}: {e}")
    exit(1)

# Find all JS files
js_files = re.findall(r'(\w*static/chunks/[^"]+\.js)', html)
js_files += re.findall(r'(/_next/static/chunks/[^"]+\.js)', html)
js_files = list(set([j.strip('"\\') for j in js_files]))

print(f"Found {len(js_files)} JS files.")

endpoints = set()
api_prefix = "https://agents-lab.fpt.ai/console/api"

for js in js_files:
    if not js.startswith('/_next/') and js.startswith('static/'):
        js_url = f"https://agents-lab.fpt.ai/_next/{js}"
    else:
        js_url = f"https://agents-lab.fpt.ai{js}" if js.startswith('/') else f"https://agents-lab.fpt.ai/{js}"
        
    try:
        req = urllib.request.Request(js_url, headers={'User-Agent': 'Mozilla/5.0'})
        js_content = urllib.request.urlopen(req).read().decode('utf-8')
        
        paths = re.findall(r'[\'"](/api/[^\'"]+)[\'"]', js_content)
        paths += re.findall(r'[\'"](/console/api/[^\'"]+)[\'"]', js_content)
        paths += re.findall(r'[\'"](console/api/[^\'"]+)[\'"]', js_content)
        paths += re.findall(r'[\'"](api/[a-zA-Z0-9_-]+[^\'"]*)[\'"]', js_content)
        paths += re.findall(r'[\'"](https?://agents-lab\.fpt\.ai[^\'"]+)[\'"]', js_content)
        
        # also search for general endpoints like /v1/..., /users/..., etc.
        # strings that start with / and have some alphabets, likely api paths
        general_paths = re.findall(r'[\'"](/[a-zA-Z0-9_-]+/[a-zA-Z0-9_/-]+)[\'"]', js_content)
        paths += general_paths
        
        # also search for common api words just in case
        for kw in ['user', 'login', 'auth', 'oauth', 'model', 'agent', 'workspace', 'session', 'tenant']:
            paths += re.findall(rf'[\'"]([^\'"]*{kw}[^\'"]*)[\'"]', js_content)
        
        for p in paths:
            # simple filter for valid looking paths
            if len(p) > 3 and not p.endswith('.js') and not p.endswith('.css') and '/' in p and '<' not in p and ' ' not in p:
                endpoints.add(p)
                
    except Exception as e:
        print(f"Failed to fetch {js_url}: {e}")

print("\n--- FOUND ENDPOINTS ---")
for ep in sorted(list(endpoints)):
    print(ep)
