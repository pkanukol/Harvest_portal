import logging
import httpx
from datetime import datetime
from .config import settings

logger = logging.getLogger(__name__)

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_HEADERS = {
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
}


def _rule_based_feedback(payload: dict) -> str:
    today = datetime.now().strftime("%d %B %Y")
    os_score = payload.get("overall_score", 0)
    rating = payload.get("rating", "BEGINNING")
    teacher_name = payload.get("teacher_name", "N/A")
    subject = payload.get("subject", "N/A")
    grade = payload.get("grade", "N/A")

    params = [
        (payload.get("p11", 0), "1.1 Knowledge of Content & Curriculum",
         "demonstrates strong subject knowledge with clear curriculum alignment and NEP integration",
         "strengthen subject knowledge and ensure explicit links to grade-level curriculum and NEP competencies"),
        (payload.get("p12", 0), "1.2 Alignment of Learning Outcomes",
         "states lesson outcomes clearly, aligned with curriculum goals and targeted competencies",
         "ensure lesson outcomes are clearly stated and explicitly mapped to curricular goals"),
        (payload.get("p21", 0), "2.1 Managing Classroom Procedures",
         "manages classroom routines and transitions effectively with student independence",
         "establish consistent routines and reduce reliance on teacher direction during transitions"),
        (payload.get("p31", 0), "3.1 Questioning & Discussion Techniques",
         "uses higher-order questions and facilitates rich peer dialogue with student reflection",
         "move beyond recall-based questions to open-ended, higher-order questioning and peer dialogue"),
        (payload.get("p32", 0), "3.2 Fostering Student Engagement",
         "fosters active student participation — students ask questions and express ideas throughout",
         "create structured opportunities for students to ask questions and express their own ideas"),
        (payload.get("p33", 0), "3.3 Implementation of Process",
         "implements all planned teaching processes and adapts them appropriately to support learning",
         "ensure all planned teaching processes are implemented as outlined in the lesson plan"),
        (payload.get("p34", 0), "3.4 Effective Use of Technology",
         "leverages BrightAI and additional digital tools effectively to enrich the lesson",
         "ensure consistent and effective use of BrightAI and all prescribed technology resources"),
    ]

    strengths = [d for v, _, d, _ in params if v >= 3]
    improvements = [i for v, _, _, i in params if v < 3]

    fb = "CLASSROOM OBSERVATION FEEDBACK\nHarvest International School\n"
    fb += f"Date: {today} | Teacher: {teacher_name} | Subject: {subject} | Grade: {grade}\n"
    fb += f"Overall Rating: {rating} ({os_score}/28)\n\n"

    if strengths:
        fb += "GLOWS (What went well):\n"
        for idx, s in enumerate(strengths, 1):
            fb += f"{idx}. The teacher {s}.\n"
        fb += "\n"

    if improvements:
        fb += "GROWS (What could have been better):\n"
        for idx, imp in enumerate(improvements, 1):
            fb += f"{idx}. {imp[0].upper() + imp[1:]}.\n"
        fb += "\n"

    fb += "KEY RECOMMENDATION:\n"
    if os_score >= 25:
        fb += "Exemplary practice across all domains. Consider this teacher as a peer mentor."
    elif os_score >= 19:
        fb += f"Strong performance. Targeted focus on {len(improvements)} development areas will sustain growth."
    elif os_score >= 12:
        selected = "; ".join(improvements[:3]) if improvements else "general skills development"
        fb += f"Good potential. Coaching focus: {selected}."
    else:
        fb += "Structured coaching support needed across multiple domains."

    infra = payload.get("infrastructure_issues", "")
    other = payload.get("other_issues", "")
    if infra and infra.strip():
        fb += f"\n\nINFRASTRUCTURE ISSUES: {infra.strip()}"
    if other and other.strip():
        fb += f"\nOTHER ISSUES: {other.strip()}"

    return fb


def _feedback_prompt(payload: dict) -> str:
    lbl = lambda n: "Distinguished" if n == 4 else ("Proficient" if n == 3 else ("Developing" if n == 2 else "Beginning"))
    p = "You are an experienced instructional coach at Harvest International School.\n"
    p += "Write a professional, warm, specific and constructive classroom observation feedback report.\n"
    p += "Target: 400-500 words. Do NOT mention raw scores in the body text.\n\n"
    p += f"TEACHER: {payload.get('teacher_name')} | SUBJECT: {payload.get('subject')} | "
    p += f"GRADE: {payload.get('grade')} | LOCATION: {payload.get('school')}\n"
    p += f"AUDITOR: {payload.get('auditor_name')} ({payload.get('auditor_designation')})\n"
    p += f"OVERALL RATING: {payload.get('rating')}\n\n"
    p += "DOMAIN 1 — PLANNING & PREPARATION:\n"
    p += f"  1.1 Knowledge of Content & Curriculum: {lbl(payload.get('p11'))}\n"
    p += f"  1.2 Alignment of Learning Outcomes: {lbl(payload.get('p12'))}\n\n"
    p += "DOMAIN 2 — CLASSROOM ENVIRONMENT:\n"
    p += f"  2.1 Managing Classroom Procedures: {lbl(payload.get('p21'))}\n\n"
    p += "DOMAIN 3 — INSTRUCTION & IMPLEMENTATION:\n"
    p += f"  3.1 Questioning & Discussion Techniques: {lbl(payload.get('p31'))}\n"
    p += f"  3.2 Fostering Student Engagement: {lbl(payload.get('p32'))}\n"
    p += f"  3.3 Implementation of Process: {lbl(payload.get('p33'))}\n"
    p += f"  3.4 Effective Use of Technology: {lbl(payload.get('p34'))}\n\n"
    infra = payload.get("infrastructure_issues", "")
    other = payload.get("other_issues", "")
    if infra and infra.strip():
        p += f"INFRASTRUCTURE ISSUES: {infra.strip()}\n"
    if other and other.strip():
        p += f"OTHER ISSUES: {other.strip()}\n"
    p += "\nStructure:\n1. Opening paragraph\n2. Strengths\n3. Areas for Development\n4. Key Recommendation\n"
    return p


def _comparison_prompt(teacher_name: str, history: list) -> str:
    p = "You are an instructional coach at Harvest International School.\n"
    p += f"Below are multiple classroom observation reports for {teacher_name}, ordered oldest to newest.\n"
    p += "Compare them and write a concise progress analysis (250-300 words).\n\n"
    for i, r in enumerate(history, 1):
        p += f"--- OBSERVATION {i} ({r['date_time'].strftime('%d %b %Y')}, by {r['auditor_name']}) ---\n"
        p += f"Overall Score: {r['overall_score']}/28  |  Rating: {r['rating']}\n"
        p += f"Domain 1 (Planning): {r['domain1_score']}/8\n"
        p += f"Domain 2 (Classroom): {r['domain2_score']}/4\n"
        p += f"Domain 3 (Instruction): {r['domain3_score']}/16\n"
        if r.get("ai_feedback"):
            p += f"Feedback summary: {r['ai_feedback'][:600].strip()}\n"
        p += "\n"
    p += "Structure:\n1. OVERALL TREND\n2. AREAS OF GROWTH\n3. PERSISTENT CHALLENGES\n4. RECOMMENDATION\n"
    return p


async def _call_claude(prompt: str, max_tokens: int) -> str:
    body = {
        "model": "claude-3-5-haiku-20241022",
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    }
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            ANTHROPIC_URL,
            headers={**ANTHROPIC_HEADERS, "x-api-key": settings.ANTHROPIC_API_KEY},
            json=body,
        )
        resp.raise_for_status()
        data = resp.json()
        return data["content"][0]["text"].strip()


async def generate_ai_feedback(payload: dict) -> str:
    if not settings.ANTHROPIC_API_KEY:
        logger.info("Anthropic API key not set — using rule-based feedback.")
        return _rule_based_feedback(payload)
    try:
        return await _call_claude(_feedback_prompt(payload), max_tokens=1200)
    except Exception as e:
        logger.error(f"Claude feedback failed: {e}")
        return _rule_based_feedback(payload)


async def generate_progress_comparison(teacher_name: str, history: list) -> str:
    if not settings.ANTHROPIC_API_KEY:
        return "Anthropic API key not configured. AI comparison is unavailable."
    try:
        return await _call_claude(_comparison_prompt(teacher_name, history), max_tokens=900)
    except Exception as e:
        logger.error(f"Claude comparison failed: {e}")
        return f"AI comparison error: {e}"
