package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	_ "time/tzdata"
)

// A simple go server returning a hello world message
func main() {
	// Load the Europe/London timezone
	loc, err := time.LoadLocation("Europe/London")
	now := time.Now().In(loc)
	zone, _ := now.Zone()

	if err != nil {
		fmt.Printf("Failed to load timezone: %s\n", err)
		return
	}

	// Create a new database connection
	db, err := NewDatabase()

	if err != nil {
		fmt.Printf("Failed to connect to database: %s\n", err)
		return
	}

	// Ensure the database is closed when the program exits
	defer db.Close()

	// Print a message to the console
	fmt.Printf("[%s %s] Connected to database\n", time.Now().In(loc).Format("2006-01-02 15:04:05"), zone)

	// Handler for the root path
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Log the request
		fmt.Printf("[%s %s] Received request: %s %s %s\n",
			time.Now().In(loc).Format("2006-01-02 15:04:05"), zone, r.RemoteAddr, r.Method, r.URL)

		// Set the header to text/html
		w.Header().Set("Content-Type", "text/html")

		// Return the contents of /app/html/bet_template.html
		http.ServeFile(w, r, "/app/html/bet_template.html")
	})

	// Handler for the /data path
	http.HandleFunc("/football/bet/data/", func(w http.ResponseWriter, r *http.Request) {
		// Create a new BetResponse
		betResponse, err := GetBetResponse(db)
		if err != nil {
			http.Error(w, "Failed to create bet response", http.StatusInternalServerError)
			return
		}

		// Marshal the betResponse to JSON
		jsonData, err := json.Marshal(betResponse)
		if err != nil {
			http.Error(w, "Failed to marshal JSON", http.StatusInternalServerError)
			return
		}

		// Set the header to application/json
		w.Header().Set("Content-Type", "application/json")

		// Write the JSON response
		w.Write(jsonData)
	})

	http.ListenAndServe(":8080", nil)
}
