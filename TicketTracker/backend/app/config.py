from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./tickets.db"
    SECRET_KEY: str = "harvest_secret_key_change_me_in_prod_1234567890"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440

    APP_URL: str = "http://localhost:5175"

    RESEND_API_KEY: str = ""
    RESEND_FROM_EMAIL: str = ""

    SUPABASE_URL: str = "https://aouvxdfamzprykezeovl.supabase.co"
    SUPABASE_ANON_KEY: str = "sb_publishable_rIfo8DPrbyOmU006ii3onw_sDRWJwvE"
    PORTAL_URL: str = "http://localhost:3000/portal/login.html"

    # Placeholder until a real WhatsApp number is provided for the responsible person.
    RESPONSIBLE_WHATSAPP_DEFAULT: str = ""

    model_config = {"env_file": ".env", "extra": "ignore"}

settings = Settings()
