from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./tickets.db"
    SECRET_KEY: str = "harvest_secret_key_change_me_in_prod_1234567890"
    ALGORITHM: str = "HS256"

    # Every user-facing link (email notifications, in-app ticket_url, WhatsApp
    # share text) now points here instead of the standalone Render frontend -
    # that app is embedded in this Netlify shell as the actual front door, and
    # the shell doesn't understand a per-ticket ?ticket= deep link, so this is
    # a flat link, not a deep link to a specific ticket.
    STAFF_DASHBOARD_URL: str = "https://his-academy360.netlify.app"

    RESEND_API_KEY: str = ""
    RESEND_FROM_EMAIL: str = ""

    SUPABASE_URL: str = "https://aouvxdfamzprykezeovl.supabase.co"
    SUPABASE_ANON_KEY: str = "sb_publishable_rIfo8DPrbyOmU006ii3onw_sDRWJwvE"

    # Placeholder until a real WhatsApp number is provided for the responsible person.
    RESPONSIBLE_WHATSAPP_DEFAULT: str = ""

    model_config = {"env_file": ".env", "extra": "ignore"}

settings = Settings()
