import os
import re

target_dir = r"C:\Users\My PC\Desktop\slamtak"

# Regex patterns to match different ways of redirecting to login.html
redirect_patterns = [
    r"window\.location\.replace\(['\"`]login\.html['\"`]\);?",
    r"window\.location\.href\s*=\s*['\"`]login\.html['\"`];?",
    r"location\.replace\(['\"`]login\.html['\"`]\);?",
    r"location\.href\s*=\s*['\"`]login\.html['\"`];?",
    r"setTimeout\(\(\)\s*=>\s*\{\s*window\.location\.href\s*=\s*['\"`]login\.html['\"`];?\s*\},?\s*\d*\);?"
]

toast_function_call = "if(typeof window.showOfflineToast === 'function') window.showOfflineToast();"

modified_files = []

for root, dirs, files in os.walk(target_dir):
    for filename in files:
        if filename.endswith(".html") and filename != "login.html":
            filepath = os.path.join(root, filename)
            
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                original_content = content
                
                # Replace all redirect patterns with the toast function call
                for pattern in redirect_patterns:
                    content = re.sub(pattern, toast_function_call, content)
                
                # Also handle specific string instances that might be split across lines
                # But regex should catch most.
                
                # Add global Toast script to the body if not exists
                toast_script = """
<script>
    if (!window.showOfflineToast) {
        window.showOfflineToast = function() {
            console.warn("Auth check failed or offline mode active. Using local data.");
            let badge = document.getElementById('offline-badge');
            if (!badge) {
                badge = document.createElement('div');
                badge.id = 'offline-badge';
                badge.innerHTML = '⚠️ وضع غير متصل - يتم عرض البيانات المحلية';
                badge.style.cssText = 'position:fixed; bottom:20px; right:20px; background:#f59e0b; color:white; padding:10px 20px; border-radius:8px; z-index:9999; font-family:cairo,sans-serif; box-shadow:0 4px 6px rgba(0,0,0,0.1); font-weight:bold; transition: opacity 0.5s;';
                document.body.appendChild(badge);
                setTimeout(() => { 
                    if(badge) badge.style.opacity = '0';
                    setTimeout(() => { if(badge && badge.parentNode) badge.parentNode.removeChild(badge); }, 500);
                }, 5000);
            }
        };
    }
</script>
</body>
"""
                if original_content != content:
                    # Inject the toast script right before </body> if we modified redirects
                    if "window.showOfflineToast" not in content and "</body>" in content:
                        content = content.replace("</body>", toast_script)
                    
                    with open(filepath, 'w', encoding='utf-8') as f:
                        f.write(content)
                    
                    modified_files.append(filename)
                    print(f"Updated {filename}")
                    
            except Exception as e:
                print(f"Error processing {filename}: {e}")

print(f"\nTotal files modified: {len(modified_files)}")
