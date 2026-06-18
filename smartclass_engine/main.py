import os
import subprocess
import sys

def main():
    print("Starting AI Smartclass Insights Dashboard...")
    dashboard_path = os.path.join(os.path.dirname(__file__), "dashboard", "app.py")
    
    if not os.path.exists(dashboard_path):
        print(f"Error: Could not find Streamlit app at {dashboard_path}")
        sys.exit(1)
        
    try:
        subprocess.run(["streamlit", "run", dashboard_path])
    except KeyboardInterrupt:
        print("Shutting down smoothly...")

if __name__ == "__main__":
    main()
