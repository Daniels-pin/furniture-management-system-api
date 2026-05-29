import { usePageHeader } from "../components/layout/pageHeader";
import { MonthlyEmployeeAttendanceCard } from "../components/employee/MonthlyEmployeeAttendanceCard";
import { useMonthlyEmployeeAttendance } from "../hooks/useMonthlyEmployeeAttendance";

export function StaffDashboardPage() {
  const attendance = useMonthlyEmployeeAttendance();

  usePageHeader({
    title: "Dashboard",
    subtitle: "Attendance for your current payroll month."
  });

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <MonthlyEmployeeAttendanceCard
        empLoading={attendance.empLoading}
        emp={attendance.emp}
        attendance={attendance.attendance}
        attBusy={attendance.attBusy}
        clockRes={attendance.clockRes}
        clockOutRes={attendance.clockOutRes}
        todayEntry={attendance.todayEntry}
        checkInAllowed={attendance.checkInAllowed}
        checkOutAllowed={attendance.checkOutAllowed}
        dayCompleted={attendance.dayCompleted}
        onMarkAttendanceWithShift={attendance.markAttendance}
        onRequestMarkAttendance={attendance.requestMarkAttendance}
        onSignOutAttendance={attendance.signOutAttendance}
        onRequestSignOut={attendance.requestSignOut}
        shiftModalOpen={attendance.shiftModalOpen}
        onShiftModalClose={() => attendance.setShiftModalOpen(false)}
        signOutConfirmOpen={attendance.signOutConfirmOpen}
        signOutPreview={attendance.signOutPreview}
        onSignOutConfirmClose={() => attendance.setSignOutConfirmOpen(false)}
        resultFeedback={attendance.resultFeedback}
        onDismissResultFeedback={attendance.dismissResultFeedback}
        missingProfileMessage="No employee profile is linked to your account yet. Ask an administrator to link your Staff login."
        showHistory={false}
        compact
      />
    </div>
  );
}
