from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from markitdown import MarkItDown
import shutil
import os

app = FastAPI()

# Configurar CORS para que tu GitHub Pages pueda comunicarse con esta API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://walterkochergomez.github.io/markdown/"], # En producción, cambia "*" por tu URL de GitHub Pages
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

md = MarkItDown()

@app.post("/convert")
async def convert_file(file: UploadFile = File(None), url: str = Form(None)):
    try:
        if file:
            # Guardar archivo temporalmente
            temp_path = f"temp_{file.filename}"
            with open(temp_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            
            # Convertir usando MarkItDown
            result = md.convert(temp_path)
            
            # Limpiar archivo temporal
            os.remove(temp_path)
            
            return {"markdown": result.text_content}
            
        elif url:
            # Convertir directamente desde URL (ej. YouTube, sitio web)
            result = md.convert(url)
            return {"markdown": result.text_content}
            
        else:
            return {"error": "No se proporcionó archivo ni URL"}
            
    except Exception as e:
        return {"error": str(e)}
