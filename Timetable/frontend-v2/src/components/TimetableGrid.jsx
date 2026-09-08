const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

// schedule: ordered list of {type: 'period'|'break', number?, label?, start, end}
// (same shape as timing_configs.schedule / parseGeneratedWorkbook's timing).
// getCell(day, periodNumber) -> {subject, teacher, manual} | null
export default function TimetableGrid({ schedule, getCell }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Day</th>
          {schedule.map((col, i) => (
            <th key={i}>
              {col.type === "period" ? `P${col.number}` : col.label || "Break"}
              <br />
              <small>{col.start}&ndash;{col.end}</small>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {DAY_LABELS.map((dayLabel, day) => (
          <tr key={dayLabel}>
            <td>{dayLabel}</td>
            {schedule.map((col, i) => {
              if (col.type !== "period") {
                return (
                  <td key={i} className="break-cell">
                    &mdash;
                  </td>
                );
              }
              const cell = getCell(day, col.number);
              return (
                <td key={i} className={cell?.manual ? "manual-cell" : undefined}>
                  {cell ? (
                    <>
                      {col.number === 0 ? "CT" : cell.subject}
                      <br />
                      <small>{cell.teacher}</small>
                    </>
                  ) : (
                    ""
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
