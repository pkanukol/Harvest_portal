"""
Resets the database completely and reseeds with fresh data.
Usage: python seed.py

WARNING: drops all tables and recreates them — all existing data is lost.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from app.database import engine, SessionLocal, Base
from app import models, auth

print("Dropping all tables...")
Base.metadata.drop_all(bind=engine)
print("Recreating all tables...")
Base.metadata.create_all(bind=engine)

USERS = [
    # --- Auditors (Admin — no subject) ---
    dict(email="pavani.k@harvestinternationalschool.in", name="Auditor Pavani", designation="Academic Auditor", role="auditor", location="Both", subject=None),
    dict(email="principal.kodathi@harvestinternationalschool.in", name="Ms Lakshmi Nayar", designation="Principal", role="auditor", location="Both", subject=None),
    dict(email="principal.attibele@harvestinternationalschool.in", name="Ms Divya Barat", designation="Principal", role="auditor", location="Both", subject=None),
    dict(email="tharunnya@harvestinternationalschool.in", name="Ms Tharunnya M A", designation="Vice Principal", role="auditor", location="Both", subject=None),
    dict(email="chitra@harvestinternationalschool.in", name="Ms Chitra Venkatesh Prasanna", designation="Curriculum Head", role="auditor", location="Both", subject=None),
    dict(email="ramanpreet@harvestinternationalschool.in", name="Ms Ramanpreet Kaur", designation="HOD", role="auditor", location="Both", subject=None),
    dict(email="chvinny@harvestinternationalschool.in", name="Ms Vinny Arora", designation="Curriculum Head", role="auditor", location="Both", subject=None),
    dict(email="sumathi@harvestinternationalschool.in", name="Ms Sumathi M S", designation="Coordinator", role="auditor", location="Kodathi", subject=None),
    dict(email="khushboo@harvestinternationalschool.in", name="Ms Khushboo Jain", designation="Coordinator", role="auditor", location="Kodathi", subject=None),
    # --- HODs (subject from Sheet 2 col F) ---
    dict(email="love@harvestinternationalschool.in", name="Mr Love Agrawal", designation="HOD", role="sme", location="Both", subject="Mathematics"),
    dict(email="jiji.francis@harvestinternationalschool.in", name="Ms Jiji Francis", designation="HOD", role="sme", location="Both", subject="Mathematics"),
    dict(email="Timsy.Thomas@harvestinternationalschool.in", name="Ms Timsy Thomas", designation="HOD", role="sme", location="Both", subject="English"),
    dict(email="chitra.ps@harvestinternationalschool.in", name="Ms Chitra P S", designation="HOD", role="sme", location="Both", subject="Computer Science"),
    dict(email="sujata.m@harvestinternationalschool.in", name="Ms Sujata Sengupta", designation="HOD", role="sme", location="Both", subject="Social Science"),
    dict(email="Shailaja@harvestinternationalschool.in", name="Ms Nanjappa Shailaja", designation="HOD", role="sme", location="Both", subject="Kannada"),
    dict(email="bani@harvestinternationalschool.in", name="Ms Bani Saha", designation="HOD", role="sme", location="Both", subject="Social Science"),
    # --- SMEs (subject from Sheet 2 col F) ---
    dict(email="deepak.d@harvestinternationalschool.in", name="Mr Deepak Damodaran", designation="Subject Matter Expert", role="sme", location="Both", subject="Science"),
    dict(email="debtanaya@harvestinternationalschool.in", name="Ms Debtanaya Banerjee", designation="Subject Matter Expert", role="sme", location="Both", subject="Social Science"),
    dict(email="levina@harvestinternationalschool.in", name="Ms Levina M", designation="Subject Matter Expert", role="sme", location="Both", subject="English"),
    dict(email="bhuvana@harvestinternationalschool.in", name="Ms Bhuvana R", designation="Subject Matter Expert", role="sme", location="Both", subject="Science"),
    dict(email="nagaraj@harvestinternationalschool.in", name="Mr Nagaraj Mudenur", designation="Subject Matter Expert", role="sme", location="Both", subject="Kannada"),
    dict(email="manju.bala@harvestinternationalschool.in", name="Ms Manju Bala", designation="Subject Matter Expert", role="sme", location="Both", subject="Hindi"),
    dict(email="francisjoy@harvestinternationalschool.in", name="Mr Francis Joy", designation="Subject Matter Expert", role="sme", location="Both", subject="Science"),
    dict(email="madhuri.j@harvestinternatinalschool.in", name="Ms Madhuri Jha", designation="Subject Matter Expert", role="sme", location="Both", subject="Hindi"),
    dict(email="sutesh@harvestinternationalschool.in", name="Ms Sutesh Yadav", designation="Subject Matter Expert", role="sme", location="Both", subject="Mathematics"),
]

# Subject lookup for teachers by name (first/primary subject from Sheet 1 col D)
TEACHER_SUBJECT = {
    "Teacher One": None,
    "Ms Chitralekha Parhi": "English",
    "Ms Mary Priyanka": "Mathematics",
    "Ms Bency Mathew": "English",
    "Ms Sangeetha Dhandapani": "Science",
    "Ms Sundari S M": "Science",
    "Ms Ashwini": "Social Science",
    "Ms Snehalatha Tambi": "Mathematics",
    "Ms Harshitha R Chandra": "Mathematics",
    "Ms Anamika": "Science",
    "Ms Ruchi Arora": "English",
    "Ms Sreeja Namboodri": "Mathematics",
    "Ms Soundari Subramaniam": "Computer Science",
    "Ms Roopa Chaurasia": "Hindi",
    "Ms Gayatri .P. Verma": "Science",
    "Ms Vidya Haridas": "Computer Science",
    "Ms Pricila Devi": "English",
    "Ms Siddamurthy Rajeswari": "Science",
    "Ms Chandni Goel": "English",
    "Ms Munirathna P": "Kannada",
    "Ms Asha Dileep": "Science",
    "Ms Preethi Kappaganthu": "English",
    "Ms Ramya Mridul Menon": "Social Science",
    "Ms Preethi S P": "Kannada",
    "Ms Navpreet Kaur": "English",
    "Ms Sonali Ghosh": "Science",
    "Ms Abha Kumar": "Hindi",
    "Ms Aditi Nair": "Science",
    "Ms Nikita Mathur": "Science",
    "Ms Pooja Jha": "Mathematics",
    "Ms Prema S R": "Kannada",
    "Mr Venkata Reddy V": "Kannada",
    "Dr Minal Pednekar": "Science",
    "Ms Ishmita Das": "English",
    "Ms Richa Trivedi": "English",
    "Mr Nitish Kumar": "Mathematics",
    "Ms Deepali Mankar": "Science",
    "Ms Harshit Kumar": "Science",
    "Ms Arundhathi P Mannikeri": "Hindi",
    "Ms Chaitra D R": "English",
    "Dr Megha Gupta": "Hindi",
    "Mr Jinit P Bavishi": "Mathematics",
    "Ms Preeti Soni": "Mathematics",
    "Ms Priya Srivastava": "Mathematics",
    "Ms Priyanka Dwivedi": "Social Science",
    "Ms Sindhu S": "Computer Science",
    "Ms Amrita Mishra": "Hindi",
    "Ms Sudharani": "Kannada",
    "Ms Nisha Singh Gautam": "Hindi",
    "Ms Anshu Rani": "Science",
    "Ms Richa Patel": "Computer Science",
    "Ms Sudha M": "Kannada",
    "Ms Aditi Das": "Computer Science",
    "Ms Punam Sharma": "Hindi",
    "Ms Priyanka Keshri": "Computer Science",
    "Ms Preeti Rajagopalan": "Mathematics",
    "Ms P Kalpana": "Mathematics",
    "Ms Nishat Fatima": "Social Science",
    "Ms Reema Mahajan": "English",
    "Ms Priya Tiwari": "Hindi",
    "Mr P Sankar Subbaiah": "Mathematics",
    "Ms Vijeta Saraf": "Hindi",
    "Ms Anna Thomas": "Computer Science",
    "Ms Ramya": "English",
    "Ms Nishanti": "English",
    "Ms Shrija": "English",
    "Ms Neethu": "English",
    "Ms Gayathri M": "Mathematics",
    "Ms Priyanka": "Mathematics",
    "Ms Nishada": "Mathematics",
    "Ms Aarti": "Mathematics",
    "Ms. Shilpi": "English",
    "Ms Leelavathi": "Mathematics",
    "Ms Sonia": "Mathematics",
    "Ms Premavathi": "Mathematics",
    "Ms Sankardevi": "Computer Science",
    "Ms Aruna": "Computer Science",
    "Ms Aswini AP": "Science",
    "Ms Roshmi Sen": "Science",
    "Ms Nimisha": "Science",
    "Ms Josephine": "Science",
    "Mr Arnab Mukerjee": "Science",
    "Ms Shoba": "Kannada",
    "Ms Vedavathi": "Kannada",
    "Ms Gayathri S": "Kannada",
    "Ms Savitha Shetty": "Kannada",
    "Ms. Kadambari": "Hindi",
    "Ms Pushpanjali": "Hindi",
    "Ms Deepa": "Hindi",
    "Mr Shawan Khan": "Hindi",
    "Ms Neelam": "Social Science",
    "Ms Pritha": "Social Science",
    "Ms Seema": "Social Science",
    "Mr Senthil Kumar": "Social Science",
    "Ms Sharmila": "English",
    "Ms Nikita Sandliya": "Social Science",
    "Ms Shobha Joshi": "Hindi",
    "Ms Ipsita Majumder": "Social Science",
    "Ms Debashree Bhattacharya": "English",
    "Ms Shweta Hiremath": "Social Science",
    "Ms Sayani Mitra": "Social Science",
    "Ms Anitha Mol PD": "Sanskrit",
    "Ms Vibha Jha": "Hindi",
    "Mr Jit Emmanuel R": "Science",
    "Ms Amita": "Sanskrit",
    "Ms Madhavi Sharma": "Science",
    "Mr Mihir Modak": "Psychology",
    "Ms Rohini S P": "Social Science",
    "Ms P R Rohita": "Social Science",
}

TEACHERS = [
    # (email, name, location, sme_email)
  ("guru@harvestinternationalschool.in", "Teacher One",   "Kodathi",  "pavani.k@harvestinternationalschool.in"),
  ('chitralekha@harvestinternationalschool.in', 'Ms Chitralekha Parhi', 'Kodathi', 'Timsy.Thomas@harvestinternationalschool.in'),
  ('priyanka@harvestinternationalschool.in', 'Ms Mary Priyanka', 'Kodathi', 'jiji.francis@harvestinternationalschool.in'),
  ('priyanka@harvestinternationalschool.in', 'Ms Mary Priyanka', 'Kodathi', 'sutesh@harvestinternationalschool.in'),
  ('priyanka@harvestinternationalschool.in', 'Ms Mary Priyanka', 'Kodathi', 'love@harvestinternationalschool.in'),
  ('bency@harvestinternationalschool.in', 'Ms Bency Mathew', 'Kodathi', 'Timsy.Thomas@harvestinternationalschool.in'),
  ('bency@harvestinternationalschool.in', 'Ms Bency Mathew', 'Kodathi', 'debtanaya@harvestinternationalschool.in'),
  ('sangeetha.d@harvestinternationalschool.in', 'Ms Sangeetha Dhandapani', 'Kodathi', 'bhuvana@harvestinternationalschool.in'),
  ('sundari@harvestinternationalschool.in', 'Ms Sundari S M', 'Kodathi', 'bhuvana@harvestinternationalschool.in'),
  ('sundari@harvestinternationalschool.in', 'Ms Sundari S M', 'Kodathi', 'francisjoy@harvestinternationalschool.in'),
  ('ashwini@harvestinternationalschool.in', 'Ms Ashwini', 'Kodathi', 'debtanaya@harvestinternationalschool.in'),
  ('snehalatha@harvestinternationalschool.in', 'Ms Snehalatha Tambi', 'Kodathi', 'sutesh@harvestinternationalschool.in'),
  ('snehalatha@harvestinternationalschool.in', 'Ms Snehalatha Tambi', 'Kodathi', 'love@harvestinternationalschool.in'),
  ('harshitha@harvestinternationalschool.in', 'Ms Harshitha R Chandra', 'Kodathi', 'sutesh@harvestinternationalschool.in'),
  ('harshitha@harvestinternationalschool.in', 'Ms Harshitha R Chandra', 'Kodathi', 'love@harvestinternationalschool.in'),
  ('anamika@harvestinternationalschool.in', 'Ms Anamika', 'Kodathi', 'deepak.d@harvestinternationalschool.in'),
  ('anamika@harvestinternationalschool.in', 'Ms Anamika', 'Kodathi', 'francisjoy@harvestinternationalschool.in'),
  ('ruchi.arora@harvestinternationalschool.in', 'Ms Ruchi Arora', 'Kodathi', 'Timsy.Thomas@harvestinternationalschool.in'),
  ('ruchi.arora@harvestinternationalschool.in', 'Ms Ruchi Arora', 'Kodathi', 'debtanaya@harvestinternationalschool.in'),
  ('sreeja_n@harvestinternationalschool.in', 'Ms Sreeja Namboodri', 'Kodathi', 'jiji.francis@harvestinternationalschool.in'),
  ('sreeja_n@harvestinternationalschool.in', 'Ms Sreeja Namboodri', 'Kodathi', 'love@harvestinternationalschool.in'),
  ('soundari@harvestinternationalschool.in', 'Ms Soundari Subramaniam', 'Kodathi', 'chitra.ps@harvestinternationalschool.in'),
  ('roopa.c@harvestinternationalschool.in', 'Ms Roopa Chaurasia', 'Kodathi', 'manju.bala@harvestinternationalschool.in'),
  ('roopa.c@harvestinternationalschool.in', 'Ms Roopa Chaurasia', 'Kodathi', 'madhuri.j@harvestinternatinalschool.in'),
  ('gayatri@harvestinternationalschool.in', 'Ms Gayatri .P. Verma', 'Kodathi', 'bhuvana@harvestinternationalschool.in'),
  ('gayatri@harvestinternationalschool.in', 'Ms Gayatri .P. Verma', 'Kodathi', 'deepak.d@harvestinternationalschool.in'),
  ('vidya.h@harvestinternationalschool.in', 'Ms Vidya Haridas', 'Kodathi', 'chitra.ps@harvestinternationalschool.in'),
  ('pricila@harvestinternationalschool.in', 'Ms Pricila Devi', 'Kodathi', 'Timsy.Thomas@harvestinternationalschool.in'),
  ('rajeswari@harvestinternationalschool.in', 'Ms Siddamurthy Rajeswari', 'Kodathi', 'francisjoy@harvestinternationalschool.in'),
  ('chandni@harvestinternationalschool.in', 'Ms Chandni Goel', 'Kodathi', 'levina@harvestinternationalschool.in'),
  ('munirathna@harvestinternationalschool.in', 'Ms Munirathna P', 'Kodathi', 'nagaraj@harvestinternationalschool.in'),
  ('asha.d@harvestinternationalschool.in', 'Ms Asha Dileep', 'Kodathi', 'francisjoy@harvestinternationalschool.in'),
  ('preethi@harvestinternationalschool.in', 'Ms Preethi Kappaganthu', 'Kodathi', 'levina@harvestinternationalschool.in'),
  ('ramya.m@harvestinternationalschool.in', 'Ms Ramya Mridul Menon', 'Kodathi', 'debtanaya@harvestinternationalschool.in'),
  ('preethi.sp@harvestinternationalschool.in', 'Ms Preethi S P', 'Kodathi', 'nagaraj@harvestinternationalschool.in'),
  ('navpreet@harvestinternationalschool.in', 'Ms Navpreet Kaur', 'Kodathi', 'levina@harvestinternationalschool.in'),
  ('sonali@harvestinternationalschool.in', 'Ms Sonali Ghosh', 'Kodathi', 'bhuvana@harvestinternationalschool.in'),
  ('sonali@harvestinternationalschool.in', 'Ms Sonali Ghosh', 'Kodathi', 'deepak.d@harvestinternationalschool.in'),
  ('abha@harvestinternationalschool.in', 'Ms Abha Kumar', 'Kodathi', 'manju.bala@harvestinternationalschool.in'),
  ('aditi.n@harvestinternationalschool.in', 'Ms Aditi Nair', 'Kodathi', 'bhuvana@harvestinternationalschool.in'),
  ('nikita.m@harvestinternationalschool.in', 'Ms Nikita Mathur', 'Kodathi', 'bhuvana@harvestinternationalschool.in'),
  ('nikita.m@harvestinternationalschool.in', 'Ms Nikita Mathur', 'Kodathi', 'francisjoy@harvestinternationalschool.in'),
  ('pooja.j@harvestinternationalschool.in', 'Ms Pooja Jha', 'Kodathi', 'jiji.francis@harvestinternationalschool.in'),
  ('pooja.j@harvestinternationalschool.in', 'Ms Pooja Jha', 'Kodathi', 'love@harvestinternationalschool.in'),
  ('prema@harvestinternationalschool.in', 'Ms Prema S R', 'Kodathi', 'nagaraj@harvestinternationalschool.in'),
  ('venkatareddy@harvestinternationalschool.in', 'Mr Venkata Reddy V', 'Kodathi', 'nagaraj@harvestinternationalschool.in'),
  ('minal@harvestinternationalschool.in', 'Dr Minal Pednekar', 'Kodathi', 'deepak.d@harvestinternationalschool.in'),
  ('ishmita@harvestinternationalschool.in', 'Ms Ishmita Das', 'Kodathi', 'debtanaya@harvestinternationalschool.in'),
  ('ishmita@harvestinternationalschool.in', 'Ms Ishmita Das', 'Kodathi', 'levina@harvestinternationalschool.in'),
  ('richa.t@harvestinternationalschool.in', 'Ms Richa Trivedi', 'Kodathi', 'levina@harvestinternationalschool.in'),
  ('nitish.un@harvestinternationalschool.in', 'Mr Nitish Kumar', 'Kodathi', 'jiji.francis@harvestinternationalschool.in'),
  ('nitish.un@harvestinternationalschool.in', 'Mr Nitish Kumar', 'Kodathi', 'love@harvestinternationalschool.in'),
  ('deepali@harvestinternationalschool.in', 'Ms Deepali Mankar', 'Kodathi', 'francisjoy@harvestinternationalschool.in'),
  ('harshit.un@harvestinternationalschool.in', 'Ms Harshit Kumar', 'Kodathi', 'deepak.d@harvestinternationalschool.in'),
  ('arundhathi@harvestinternationalschool.in', 'Ms Arundhathi P Mannikeri', 'Kodathi', 'manju.bala@harvestinternationalschool.in'),
  ('arundhathi@harvestinternationalschool.in', 'Ms Arundhathi P Mannikeri', 'Kodathi', 'madhuri.j@harvestinternatinalschool.in'),
  ('chaitra.dr@harvestinternationalschool.in', 'Ms Chaitra D R', 'Kodathi', 'levina@harvestinternationalschool.in'),
  ('megha.g@harvestinternationalschool.in', 'Dr Megha Gupta', 'Kodathi', 'manju.bala@harvestinternationalschool.in'),
  ('megha.g@harvestinternationalschool.in', 'Dr Megha Gupta', 'Kodathi', 'madhuri.j@harvestinternatinalschool.in'),
  ('jinit@harvestinternationalschool.in', 'Mr Jinit P Bavishi', 'Kodathi', 'love@harvestinternationalschool.in'),
  ('jinit@harvestinternationalschool.in', 'Mr Jinit P Bavishi', 'Kodathi', 'jiji.francis@harvestinternationalschool.in'),
  ('jinit@harvestinternationalschool.in', 'Mr Jinit P Bavishi', 'Kodathi', 'deepak.d@harvestinternationalschool.in'),
  ('preeti@harvestinternationalschool.in', 'Ms Preeti Soni', 'Kodathi', 'love@harvestinternationalschool.in'),
  ('preeti@harvestinternationalschool.in', 'Ms Preeti Soni', 'Kodathi', 'sutesh@harvestinternationalschool.in'),
  ('priya.s@harvestinternationalschool.in', 'Ms Priya Srivastava', 'Kodathi', 'jiji.francis@harvestinternationalschool.in'),
  ('priya.s@harvestinternationalschool.in', 'Ms Priya Srivastava', 'Kodathi', 'love@harvestinternationalschool.in'),
  ('priyanka.d@harvestinternationalschool.in', 'Ms Priyanka Dwivedi', 'Kodathi', 'debtanaya@harvestinternationalschool.in'),
  ('sindhu@harvestinternationalschool.in', 'Ms Sindhu S', 'Kodathi', 'chitra.ps@harvestinternationalschool.in'),
  ('amritamishra@harvestinternationalschool.in', 'Ms Amrita Mishra', 'Kodathi', 'madhuri.j@harvestinternatinalschool.in'),
  ('sudharani@harvestinternationalschool.in', 'Ms Sudharani', 'Kodathi', 'nagaraj@harvestinternationalschool.in'),
  ('nisha.singh@harvestinternationalschool.in', 'Ms Nisha Singh Gautam', 'Kodathi', 'manju.bala@harvestinternationalschool.in'),
  ('nisha.singh@harvestinternationalschool.in', 'Ms Nisha Singh Gautam', 'Kodathi', 'madhuri.j@harvestinternatinalschool.in'),
  ('richa.t@harvestinternationalschool.in', 'Ms Richa Trivedi', 'Kodathi', 'debtanaya@harvestinternationalschool.in'),
  ('anshu@harvestinternationalschool.in', 'Ms Anshu Rani', 'Kodathi', 'bhuvana@harvestinternationalschool.in'),
  ('anshu@harvestinternationalschool.in', 'Ms Anshu Rani', 'Kodathi', 'deepak.d@harvestinternationalschool.in'),
  ('richa.p@harvestinternationalschool.in', 'Ms Richa Patel', 'Kodathi', 'chitra.ps@harvestinternationalschool.in'),
  ('sudha.m@harvestinternationalschool.in', 'Ms Sudha M', 'Kodathi', 'nagaraj@harvestinternationalschool.in'),
  ('adithi.das@harvestinternationalschool.in', 'Ms Aditi Das', 'Kodathi', 'chitra.ps@harvestinternationalschool.in'),
  ('punam.s@harvestinternationalschool.in', 'Ms Punam Sharma', 'Kodathi', 'manju.bala@harvestinternationalschool.in'),
  ('punam.s@harvestinternationalschool.in', 'Ms Punam Sharma', 'Kodathi', 'madhuri.j@harvestinternatinalschool.in'),
  ('priyanka.k@harvestinternationalschool.in', 'Ms Priyanka Keshri', 'Kodathi', 'chitra.ps@harvestinternationalschool.in'),
  ('priyanka.k@harvestinternationalschool.in', 'Ms Priyanka Keshri', 'Kodathi', 'sutesh@harvestinternationalschool.in'),
  ('priyanka.k@harvestinternationalschool.in', 'Ms Priyanka Keshri', 'Kodathi', 'love@harvestinternationalschool.in'),
  ('preeti.rajagopalan@harvestinternationalschool.in', 'Ms Preeti Rajagopalan', 'Kodathi', 'sutesh@harvestinternationalschool.in'),
  ('preeti.rajagopalan@harvestinternationalschool.in', 'Ms Preeti Rajagopalan', 'Kodathi', 'love@harvestinternationalschool.in'),
  ('kalpana.p@harvestinternationalschool.in', 'Ms P Kalpana', 'Kodathi', 'jiji.francis@harvestinternationalschool.in'),
  ('kalpana.p@harvestinternationalschool.in', 'Ms P Kalpana', 'Kodathi', 'love@harvestinternationalschool.in'),
  ('nishat.f@harvestinternationalschool.in', 'Ms Nishat Fatima', 'Kodathi', 'debtanaya@harvestinternationalschool.in'),
  ('reema.m@harvestinternationalschool.in', 'Ms Reema Mahajan', 'Kodathi', 'Timsy.Thomas@harvestinternationalschool.in'),
  ('priya.tiwari@harvestinternationalschool.in', 'Ms Priya Tiwari', 'Kodathi', 'manju.bala@harvestinternationalschool.in'),
  ('priya.tiwari@harvestinternationalschool.in', 'Ms Priya Tiwari', 'Kodathi', 'madhuri.j@harvestinternatinalschool.in'),
  ('sankar.p@harvestinternationalschool.in', 'Mr P Sankar Subbaiah', 'Kodathi', 'jiji.francis@harvestinternationalschool.in'),
  ('sankar.p@harvestinternationalschool.in', 'Mr P Sankar Subbaiah', 'Kodathi', 'love@harvestinternationalschool.in'),
  ('vijeta.saraf@harvestinternationalschool.in', 'Ms Vijeta Saraf', 'Kodathi', 'madhuri.j@harvestinternatinalschool.in'),
  ('anna.thomas@harvestinternationalschool.in', 'Ms Anna Thomas', 'Kodathi', 'chitra.ps@harvestinternationalschool.in'),
  ('ramya.atb@harvestinternationalschool.in', 'Ms Ramya', 'Attibele', 'levina@harvestinternationalschool.in'),
  ('nishanthi@harvestinternationalschool.in', 'Ms Nishanti', 'Attibele', 'levina@harvestinternationalschool.in'),
  ('shrija@harvestinternationalschool.in', 'Ms Shrija', 'Attibele', 'Timsy.Thomas@harvestinternationalschool.in'),
  ('neethu@harvestinternationalschool.in', 'Ms Neethu', 'Attibele', 'Timsy.Thomas@harvestinternationalschool.in'),
  ('nishada@harvestinternationalschool.in', 'Ms Nishada', 'Attibele', 'jiji.francis@harvestinternationalschool.in'),
  ('nishada@harvestinternationalschool.in', 'Ms Nishada', 'Attibele', 'love@harvestinternationalschool.in'),
  ('aarti.r@harvestinternationalschool.in', 'Ms Aarti', 'Attibele', 'sutesh@harvestinternationalschool.in'),
  ('aarti.r@harvestinternationalschool.in', 'Ms Aarti', 'Attibele', 'love@harvestinternationalschool.in'),
  ('leelavathi.m@harvestinternationalschool.in', 'Ms Leelavathi', 'Attibele', 'jiji.francis@harvestinternationalschool.in'),
  ('leelavathi.m@harvestinternationalschool.in', 'Ms Leelavathi', 'Attibele', 'love@harvestinternationalschool.in'),
  ('soniasahoo@harvestinternationalschool.in', 'Ms Sonia', 'Attibele', 'jiji.francis@harvestinternationalschool.in'),
  ('soniasahoo@harvestinternationalschool.in', 'Ms Sonia', 'Attibele', 'love@harvestinternationalschool.in'),
  ('premavathi.n@harvestinternationalschool.in', 'Ms Premavathi', 'Attibele', 'jiji.francis@harvestinternationalschool.in'),
  ('premavathi.n@harvestinternationalschool.in', 'Ms Premavathi', 'Attibele', 'love@harvestinternationalschool.in'),
  ('sankar.devi@harvestinternationalschool.in', 'Ms Sankardevi', 'Attibele', 'chitra.ps@harvestinternationalschool.in'),
  ('aruna@harvestinternationalschool.in', 'Ms Aruna', 'Attibele', 'chitra.ps@harvestinternationalschool.in'),
  ('aruna@harvestinternationalschool.in', 'Ms Aruna', 'Attibele', 'deepak.d@harvestinternationalschool.in'),
  ('aswini.ap@harvestinternationalschool.in', 'Ms Aswini AP', 'Attibele', 'bhuvana@harvestinternationalschool.in'),
  ('aswini.ap@harvestinternationalschool.in', 'Ms Aswini AP', 'Attibele', 'deepak.d@harvestinternationalschool.in'),
  ('roshmi.sen@harvestinternationalschool.in', 'Ms Roshmi Sen', 'Attibele', 'francisjoy@harvestinternationalschool.in'),
  ('nimisha.gaur@harvestinternationalschool.in', 'Ms Nimisha', 'Attibele', 'francisjoy@harvestinternationalschool.in'),
  ('josephine.jenifer@harvestinternationalschool.in', 'Ms Josephine', 'Attibele', 'bhuvana@harvestinternationalschool.in'),
  ('arnab@harvestinternationalschool.in', 'Mr Arnab Mukerjee', 'Attibele', 'deepak.d@harvestinternationalschool.in'),
  ('arnab@harvestinternationalschool.in', 'Mr Arnab Mukerjee', 'Attibele', 'francisjoy@harvestinternationalschool.in'),
  ('shoba.m@harvestinternationalschool.in', 'Ms Shoba', 'Attibele', 'nagaraj@harvestinternationalschool.in'),
  ('vedavathi.m@harvestinternationalschool.in', 'Ms Vedavathi', 'Attibele', 'nagaraj@harvestinternationalschool.in'),
  ('gayathri.sampath@harvestinternationalschool.in', 'Ms Gayathri S', 'Attibele', 'nagaraj@harvestinternationalschool.in'),
  ('savitha.shetty@harvestinternationalschool.in', 'Ms Savitha Shetty', 'Attibele', 'nagaraj@harvestinternationalschool.in'),
  ('kadambari@harvestinternationalschool.in', 'Ms. Kadambari', 'Attibele', 'manju.bala@harvestinternationalschool.in'),
  ('kadambari@harvestinternationalschool.in', 'Ms. Kadambari', 'Attibele', 'madhuri.j@harvestinternatinalschool.in'),
  ('pushpanjali@harvestinternationalschool.in', 'Ms Pushpanjali', 'Attibele', 'manju.bala@harvestinternationalschool.in'),
  ('pushpanjali@harvestinternationalschool.in', 'Ms Pushpanjali', 'Attibele', 'madhuri.j@harvestinternatinalschool.in'),
  ('deepa.r@harvestinternationalschool.in', 'Ms Deepa', 'Attibele', 'manju.bala@harvestinternationalschool.in'),
  ('Shawan@harvestinternationalschool.in', 'Mr Shawan Khan', 'Attibele', 'madhuri.j@harvestinternatinalschool.in'),
  ('neelam.singh@harvestinternationalschool.in', 'Ms Neelam', 'Attibele', 'debtanaya@harvestinternationalschool.in'),
  ('pritha.b@harvestinternationalschool.in', 'Ms Pritha', 'Attibele', 'debtanaya@harvestinternationalschool.in'),
  ('seema.s@harvestinternationalschool.in', 'Ms Seema', 'Attibele', 'debtanaya@harvestinternationalschool.in'),
  ('Sharmila.kumari@harvestinternationalschool.in', 'Ms Sharmila', 'Attibele', 'Timsy.Thomas@harvestinternationalschool.in'),
  ('debashree@harvestinternationalschool.in', 'Ms Debashree Bhattacharya', 'Kodathi', 'Timsy.Thomas@harvestinternationalschool.in'),
  ('shobha@harvestinternationalschool.in', 'Ms Shobha Joshi', 'Kodathi', 'manju.bala@harvestinternationalschool.in'),
  ('shobha@harvestinternationalschool.in', 'Ms Shobha Joshi', 'Kodathi', 'madhuri.j@harvestinternatinalschool.in'),
  ('ipsita@harvestinternationalschool.in', 'Ms Ipsita Majumder', 'Kodathi', 'sujata.m@harvestinternationalschool.in'),
  ('nikita@harvestinternationalschool.in', 'Ms Nikita Sandliya', 'Kodathi', 'sujata.m@harvestinternationalschool.in'),
  ('shweta.h@harvestinternationalschool.in', 'Ms Shweta Hiremath', 'Kodathi', 'sujata.m@harvestinternationalschool.in'),
  ('sayani@harvestinternationalachool.in', 'Ms Sayani Mitra', 'Kodathi', 'sujata.m@harvestinternationalschool.in'),
  ('senthil.kumar@harvestinternationalschool.in', 'Mr Senthil Kumar', 'Attibele', 'sujata.m@harvestinternationalschool.in'),
  ('pritha.b@harvestinternationalschool.in', 'Ms Pritha', 'Attibele', 'sujata.m@harvestinternationalschool.in'),
  ('seema.s@harvestinternationalschool.in', 'Ms Seema', 'Attibele', 'sujata.m@harvestinternationalschool.in'),
  ('anitha.m@harvestinternationalschool.in', 'Ms Anitha Mol PD', 'Kodathi', 'pavani.k@harvestinternationalschool.in'),
  ('anitha.m@harvestinternationalschool.in', 'Ms Anitha Mol PD', 'Kodathi', 'principal.kodathi@harvestinternationalschool.in'),
  ('anitha.m@harvestinternationalschool.in', 'Ms Anitha Mol PD', 'Kodathi', 'chitra@harvestinternationalschool.in'),
  ('anitha.m@harvestinternationalschool.in', 'Ms Anitha Mol PD', 'Kodathi', 'chvinny@harvestinternationalschool.in'),
  ('vibha@harvestinternationalschool.in', 'Ms Vibha Jha', 'Kodathi', 'pavani.k@harvestinternationalschool.in'),
  ('vibha@harvestinternationalschool.in', 'Ms Vibha Jha', 'Kodathi', 'principal.kodathi@harvestinternationalschool.in'),
  ('vibha@harvestinternationalschool.in', 'Ms Vibha Jha', 'Kodathi', 'chitra@harvestinternationalschool.in'),
  ('vibha@harvestinternationalschool.in', 'Ms Vibha Jha', 'Kodathi', 'chvinny@harvestinternationalschool.in'),
  ('jith@harvestinternationalschool.in', 'Mr Jit Emmanuel R', 'Kodathi', 'pavani.k@harvestinternationalschool.in'),
  ('jith@harvestinternationalschool.in', 'Mr Jit Emmanuel R', 'Kodathi', 'principal.kodathi@harvestinternationalschool.in'),
  ('jith@harvestinternationalschool.in', 'Mr Jit Emmanuel R', 'Kodathi', 'chitra@harvestinternationalschool.in'),
  ('jith@harvestinternationalschool.in', 'Mr Jit Emmanuel R', 'Kodathi', 'chvinny@harvestinternationalschool.in'),
  ('mihir.modak@harvestinternationalschool.in', 'Mr Mihir Modak', 'Kodathi', 'pavani.k@harvestinternationalschool.in'),
  ('mihir.modak@harvestinternationalschool.in', 'Mr Mihir Modak', 'Kodathi', 'principal.kodathi@harvestinternationalschool.in'),
  ('mihir.modak@harvestinternationalschool.in', 'Mr Mihir Modak', 'Kodathi', 'chitra@harvestinternationalschool.in'),
  ('mihir.modak@harvestinternationalschool.in', 'Mr Mihir Modak', 'Kodathi', 'chvinny@harvestinternationalschool.in'),
  ('rohini.sp@harvestinternationalschool.in', 'Ms Rohini S P', 'Kodathi', 'pavani.k@harvestinternationalschool.in'),
  ('rohini.sp@harvestinternationalschool.in', 'Ms Rohini S P', 'Kodathi', 'principal.kodathi@harvestinternationalschool.in'),
  ('rohini.sp@harvestinternationalschool.in', 'Ms Rohini S P', 'Kodathi', 'chitra@harvestinternationalschool.in'),
  ('rohini.sp@harvestinternationalschool.in', 'Ms Rohini S P', 'Kodathi', 'chvinny@harvestinternationalschool.in'),
  ('rohita@harvestinternationalschool.in', 'Ms P R Rohita', 'Kodathi', 'pavani.k@harvestinternationalschool.in'),
  ('rohita@harvestinternationalschool.in', 'Ms P R Rohita', 'Kodathi', 'principal.kodathi@harvestinternationalschool.in'),
  ('rohita@harvestinternationalschool.in', 'Ms P R Rohita', 'Kodathi', 'chitra@harvestinternationalschool.in'),
  ('rohita@harvestinternationalschool.in', 'Ms P R Rohita', 'Kodathi', 'chvinny@harvestinternationalschool.in'),
  ('amita@harvestinternationalschool.in', 'Ms Amita', 'Attibele', 'pavani.k@harvestinternationalschool.in'),
  ('amita@harvestinternationalschool.in', 'Ms Amita', 'Attibele', 'principal.attibele@harvestinternationalschool.in'),
  ('amita@harvestinternationalschool.in', 'Ms Amita', 'Attibele', 'chitra@harvestinternationalschool.in'),
  ('amita@harvestinternationalschool.in', 'Ms Amita', 'Attibele', 'chvinny@harvestinternationalschool.in'),
  ('madhavi.sharma@harvestinternationalschool.in', 'Ms Madhavi Sharma', 'Attibele', 'pavani.k@harvestinternationalschool.in'),
  ('madhavi.sharma@harvestinternationalschool.in', 'Ms Madhavi Sharma', 'Attibele', 'principal.attibele@harvestinternationalschool.in'),
  ('madhavi.sharma@harvestinternationalschool.in', 'Ms Madhavi Sharma', 'Attibele', 'chitra@harvestinternationalschool.in'),
  ('madhavi.sharma@harvestinternationalschool.in', 'Ms Madhavi Sharma', 'Attibele', 'chvinny@harvestinternationalschool.in'),
  
]


DEFAULT_PASSWORD = "password123"


def seed():
    db = SessionLocal()
    try:
        # --- Auditors & SMEs ---
        for u in USERS:
            db.add(models.User(
                email=u["email"].lower(),
                password_hash=auth.get_password_hash(DEFAULT_PASSWORD),
                name=u["name"],
                designation=u["designation"],
                role=u["role"],
                location=u["location"],
                app_password=DEFAULT_PASSWORD,
                subject=u.get("subject"),
            ))
            print(f"  added {u['email']}")
        db.commit()

        # --- Teachers: one user record per unique email ---
        seen_teachers = {}  # email -> User id
        for email, name, location, sme_email in TEACHERS:
            key = email.lower()
            if key not in seen_teachers:
                teacher = models.User(
                    email=key,
                    password_hash=auth.get_password_hash(DEFAULT_PASSWORD),
                    name=name,
                    designation="Primary Teacher",
                    role="teacher",
                    location=location,
                    app_password=DEFAULT_PASSWORD,
                    subject=TEACHER_SUBJECT.get(name),
                )
                db.add(teacher)
                db.flush()  # get teacher.id without full commit
                seen_teachers[key] = teacher.id
                print(f"  added teacher {key}")
        db.commit()

        # --- teacher_sme assignments ---
        for email, name, location, sme_email in TEACHERS:
            teacher_id = seen_teachers.get(email.lower())
            sme = db.query(models.User).filter(
                models.User.email == sme_email.lower()
            ).first()
            if not sme:
                print(f"  WARN: SME {sme_email} not found — skipping assignment for {email}")
                continue
            if not teacher_id:
                continue
            # avoid duplicate assignments
            exists = db.query(models.TeacherSME).filter_by(
                teacher_id=teacher_id, sme_id=sme.id
            ).first()
            if not exists:
                db.add(models.TeacherSME(teacher_id=teacher_id, sme_id=sme.id))
                print(f"  linked {email} -> {sme_email}")
        db.commit()

        print("\nDone. Teachers and their SME assignments:")
        for t in db.query(models.User).filter(models.User.role == "teacher").order_by(models.User.id).all():
            smes = [a.sme.name for a in db.query(models.TeacherSME).filter_by(teacher_id=t.id).all()]
            print(f"  [{t.id}] {t.email:<50} SMEs: {', '.join(smes) or 'none'}")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
