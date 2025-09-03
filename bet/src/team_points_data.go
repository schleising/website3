package main

import "fmt"

// TeamPointsData holds the points data for a team
type TeamPointsData struct {
	teamName                 string
	otherTeamNames           []string
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

type tableData struct {
	table LiveTableItem
	err   error
}

type matchData struct {
	matches []Match
	err     error
}

func NewTeamPointsData(db *Database, teamName string, otherTeamNames []string) (*TeamPointsData, error) {
	tpd := &TeamPointsData{
		teamName:       teamName,
		otherTeamNames: otherTeamNames,
	}

	teamLeagueDataCh := make(chan *tableData)
	teamH2HDataCh := make(chan *matchData)
	teamLatestMatchCh := make(chan *matchData)

	// Get the team league data
	go func() {
		teamData, err := db.GetTeamLeagueDataDb(teamName)
		teamLeagueDataCh <- &tableData{table: *teamData, err: err}
	}()

	// Get the head to head data
	go func() {
		h2hData, err := db.GetHeadToHeadMatchesDb(otherTeamNames[0], otherTeamNames[1])
		teamH2HDataCh <- &matchData{matches: h2hData, err: err}
	}()

	// Get the latest match data
	go func() {
		latestMatchData, err := db.GetLatestTeamMatchDb(teamName)
		teamLatestMatchCh <- &matchData{matches: []Match{*latestMatchData}, err: err}
	}()

	// Wait for the database responses
	teamLeagueData := <-teamLeagueDataCh
	teamH2HData := <-teamH2HDataCh
	teamLatestMatchData := <-teamLatestMatchCh

	// Check for errors
	if teamLeagueData.err != nil {
		return nil, fmt.Errorf("failed to get team league data: %w", teamLeagueData.err)
	}
	if teamH2HData.err != nil {
		return nil, fmt.Errorf("failed to get team head-to-head data: %w", teamH2HData.err)
	}
	if teamLatestMatchData.err != nil {
		return nil, fmt.Errorf("failed to get team latest match data: %w", teamLatestMatchData.err)
	}

	// Populate the TeamPointsData struct
	tpd.currentPoints = teamLeagueData.table.Points
	tpd.adjustedPoints = teamLeagueData.table.Points
	tpd.matchesPlayed = teamLeagueData.table.PlayedGames
	tpd.remainingMatches = 38 - teamLeagueData.table.PlayedGames

	// Calculate the number of remaining head-to-head matches
	for _, match := range teamH2HData.matches {
		if !match.HasFinished() {
			tpd.remainingOtherH2HMatches++
		}
	}

	// Adjust the points for any matches currently in play
	tpd.adjustInPlayMatches(&teamLatestMatchData.matches[0])

	return tpd, nil
}

func (tpd *TeamPointsData) adjustInPlayMatches(teamLatestMatch *Match) {
	if teamLatestMatch.IsLive() {
		// Add one to the matches remaining
		tpd.remainingMatches += 1

		// Subtract the points for a live match
		tpd.adjustedPoints -= teamLatestMatch.TeamPoints(tpd.teamName)

		// Set the live flag
		tpd.matchInPlay = true

		// Store the in play match details
		tpd.inPlayHomeTeam = teamLatestMatch.HomeTeam.Tla
		tpd.inPlayAwayTeam = teamLatestMatch.AwayTeam.Tla
		tpd.inPlayHomeTeamScore = teamLatestMatch.Score.FullTime.Home
		tpd.inPlayAwayTeamScore = teamLatestMatch.Score.FullTime.Away
	}
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
