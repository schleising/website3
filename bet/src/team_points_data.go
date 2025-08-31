package main

// TeamPointsData holds the points data for a team
type TeamPointsData struct {
	teamName                 string
	currentPoints            int
	adjustedPoints           int
	matchesPlayed            int
	remainingMatches         int
	remainingOtherH2HMatches int
	matchInPlay              bool
	inPlayHomeTeam           string
	inPlayAwayTeam           string
	inPlayHomeTeamScore      int
	inPlayAwayTeamScore      int
}

func (this_team *TeamPointsData) teamBestCase(other_team *TeamPointsData) int {
	// Calculate the max points for this team
	max_own_points := this_team.adjustedPoints + (this_team.remainingMatches * 3)

	// Calculate the min points for the other team
	min_other_points := other_team.adjustedPoints +
		other_team.remainingMatches*0 +
		this_team.remainingOtherH2HMatches*1

	// Calculate the point difference
	return max_own_points - min_other_points
}

func (this_team *TeamPointsData) BestCase(team_1, team_2 *TeamPointsData) int {
	return (this_team.teamBestCase(team_1) + this_team.teamBestCase(team_2)) * 5
}

func (this_team *TeamPointsData) teamWorstCase(other_team *TeamPointsData) int {
	// Calculate the min points for this team
	min_own_points := this_team.adjustedPoints + (this_team.remainingMatches * 0)

	// Calculate the max points for the other team
	max_other_points := other_team.adjustedPoints + ((other_team.remainingMatches - this_team.remainingOtherH2HMatches) * 3)

	// Calculate the point difference
	return min_own_points - max_other_points
}

func (this_team *TeamPointsData) WorstCase(team_1, team_2 *TeamPointsData) int {
	return (this_team.teamWorstCase(team_1) + this_team.teamWorstCase(team_2) - (this_team.remainingOtherH2HMatches * 3)) * 5
}
