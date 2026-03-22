import os
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from routers import documents, stories, github_analysis, jira

app = FastAPI(
    title="DevTrack AI Microservice",
    description="AI-powered story generation, document ingestion, and code analysis service",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(documents.router, prefix="/documents", tags=["Documents"])
app.include_router(stories.router, prefix="/stories", tags=["Stories"])
app.include_router(github_analysis.router, prefix="/github", tags=["GitHub Analysis"])
app.include_router(jira.router, prefix="/jira", tags=["Jira"])


@app.get("/")
async def root():
    return {"status": "OK", "service": "DevTrack AI Service", "version": "1.0.0"}


@app.get("/health")
async def health():
    return {"status": "healthy", "llm": os.getenv("LLM_MODEL"), "embedding": os.getenv("EMBEDDING_MODEL")}


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    return JSONResponse(
        status_code=500,
        content={"success": False, "message": str(exc)},
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", 8000)), reload=True)
