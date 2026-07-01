export const RUBRICS = [
  {
    domain: "Domain 1: Planning & Preparation",
    params: [
      {
        key: "p11",
        code: "1.1",
        title: "Knowledge of Content and Curriculum",
        levels: [
          { score: 4, label: "Distinguished", desc: "Demonstrates accurate subject knowledge, explicitly connects instruction to grade-level curriculum, and integrates relevant pedagogies into the lesson." },
          { score: 3, label: "Proficient", desc: "Demonstrates accurate subject knowledge and aligns instruction to grade-level curriculum." },
          { score: 2, label: "Developing", desc: "Demonstrates accurate subject knowledge but does not clearly align instruction to grade-level curriculum." },
          { score: 1, label: "Beginning", desc: "Observed gaps or inaccuracies in subject knowledge." },
        ],
      },
      {
        key: "p12",
        code: "1.2",
        title: "Alignment of Learning Outcomes",
        levels: [
          { score: 4, label: "Distinguished", desc: "Learning Outcomes are clearly stated at the beginning of the lesson, referred to during instruction, and students can explain what they learned by the end of the session." },
          { score: 3, label: "Proficient", desc: "Learning Outcomes are clearly stated at the beginning of the lesson, and students can describe what they learned by the end of the session." },
          { score: 2, label: "Developing", desc: "Learning Outcomes are stated at the beginning of the lesson and students can state what they learned by the end of the session." },
          { score: 1, label: "Beginning", desc: "Learning Outcomes are not stated at the beginning of the lesson, or students are not able to state what they learned by the end of the session." },
        ],
      },
    ],
  },
  {
    domain: "Domain 2: Classroom Environment",
    params: [
      {
        key: "p21",
        code: "2.1",
        title: "Managing Classroom Procedures",
        levels: [
          { score: 4, label: "Distinguished", desc: "Routines are followed independently by students, transitions are completed without teacher intervention, and materials are ready before instruction begins." },
          { score: 3, label: "Proficient", desc: "Routines are established, transitions occur with minimal teacher direction, and materials are organized for instruction." },
          { score: 2, label: "Developing", desc: "Routines or transitions require repeated teacher direction, or materials are not fully prepared." },
          { score: 1, label: "Beginning", desc: "Routines are not established, transitions disrupt learning, and materials are disorganized." },
        ],
      },
    ],
  },
  {
    domain: "Domain 3: Instruction & Implementation",
    params: [
      {
        key: "p31",
        code: "3.1",
        title: "Questioning & Discussion Techniques",
        levels: [
          { score: 4, label: "Distinguished", desc: "Questions are aligned to the learning outcomes. The teacher intentionally invites responses from different types of learners using strategies such as prompts, scaffolds, cold call, no-opt-out, or think-pair-share." },
          { score: 3, label: "Proficient", desc: "Questions are aligned to the learning outcomes. The teacher invites responses using strategies such as prompts, scaffolds, cold call, no-opt-out, or think-pair-share." },
          { score: 2, label: "Developing", desc: "Questions are aligned to the learning outcomes. Participation is limited to students who volunteer responses." },
          { score: 1, label: "Beginning", desc: "The lesson is predominantly teacher-centred, with limited questioning and minimal opportunities for students to think, respond, or discuss." },
        ],
      },
      {
        key: "p32",
        code: "3.2",
        title: "Fostering Student Engagement",
        levels: [
          { score: 4, label: "Distinguished", desc: "Students are engaged through a combination of questioning, discussion, and learning activities, with opportunities to share ideas and ask questions." },
          { score: 3, label: "Proficient", desc: "Students are engaged through questioning and learning activities, with opportunities to respond to the teacher." },
          { score: 2, label: "Developing", desc: "Students are engaged primarily through teacher questioning; opportunities to share ideas, ask questions, or participate in activities are limited." },
          { score: 1, label: "Beginning", desc: "Students primarily listen to the teacher; opportunities to respond, share ideas, ask questions, or participate in activities are not evident." },
        ],
      },
      {
        key: "p33",
        code: "3.3",
        title: "Implementation of Process",
        levels: [
          { score: 4, label: "Distinguished", desc: "Implements all planned teaching processes and procedures and adjusts them appropriately to support learning goals." },
          { score: 3, label: "Proficient", desc: "Implements all planned teaching processes and procedures as outlined in the lesson plan." },
          { score: 2, label: "Developing", desc: "Implements some planned teaching processes and procedures." },
          { score: 1, label: "Beginning", desc: "Does not follow the planned teaching process." },
        ],
      },
      {
        key: "p34",
        code: "3.4",
        title: "Effective Use of Technology",
        levels: [
          { score: 4, label: "Distinguished", desc: "Technology is used as outlined in the lesson plan, and relevant platform features are used to support teaching and learning." },
          { score: 3, label: "Proficient", desc: "Technology resources identified in the lesson plan are used during the lesson, but only for selected parts of instruction." },
          { score: 2, label: "Developing", desc: "The teacher does not use the technology resources specified in the lesson plan or spends instructional time searching for, opening, or setting up the resources." },
          { score: 1, label: "Beginning", desc: "Technology resources are not used to support lesson delivery or the teacher is not aware of how to use them." },
        ],
      },
    ],
  },
];

export const DRAWER_PARAM_LABELS = [
  ["p11", "1.1 Content Knowledge"],
  ["p12", "1.2 Learning Outcomes"],
  ["p21", "2.1 Managing Procedures"],
  ["p31", "3.1 Questioning & Disc."],
  ["p32", "3.2 Student Engagement"],
  ["p33", "3.3 Process Impl."],
  ["p34", "3.4 Effective Tech Use"],
];
