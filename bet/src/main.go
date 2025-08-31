package main

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// A simple go server returning a hello world message
func main() {
	// Handler for the root path
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Log the request
		fmt.Printf("Received request: %s %s %s\n", r.RemoteAddr, r.Method, r.URL)

		// Set the header to text/html
		w.Header().Set("Content-Type", "text/html")

		// Return the contents of /app/html/bet_template.html
		http.ServeFile(w, r, "/app/html/bet_template.html")
	})

	// Handler for the /data path
	http.HandleFunc("/football/bet/data/", func(w http.ResponseWriter, r *http.Request) {
		// Log the request
		fmt.Printf("Received request: %s %s %s\n", r.RemoteAddr, r.Method, r.URL)

		// Create a new BetResponse
		betResponse, err := GetBetResponse()
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
