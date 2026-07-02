from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./audit.db"
    SECRET_KEY: str = "harvest_secret_key_change_me_in_prod_1234567890"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440

    ANTHROPIC_API_KEY: str = ""
    #APP_URL: str = "https://harvest-ta.onrender.com"
    APP_URL: str = "https://harvest-dlp-portal.onrender.com"

    RESEND_API_KEY: str = ""
    RESEND_FROM_EMAIL: str = ""
    #SMTP_HOST: str = "smtp.gmail.com"
    #SMTP_PORT: int = 587
    #SMTP_USERNAME: str = ""
    #SMTP_PASSWORD: str = ""
    #SMTP_FROM_EMAIL: str = ""

    SUPABASE_URL: str = "https://aouvxdfamzprykezeovl.supabase.co"
    SUPABASE_ANON_KEY: str = "sb_publishable_rIfo8DPrbyOmU006ii3onw_sDRWJwvE"
    PORTAL_URL: str = "https://harvest-portal.onrender.com/portal/login.html"

    model_config = {"env_file": ".env", "extra": "ignore"}

settings = Settings()
