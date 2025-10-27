package main

import (
	"encoding/json"
	"fmt"
	"html/template"
	"net"
	"net/http"
	"time"

	_ "time/tzdata"

	"github.com/oschwald/geoip2-golang"
)

// A simple go server returning a hello world message
func main() {
	// Load the Europe/London timezone
	loc, err := time.LoadLocation("Europe/London")

	if err != nil {
		fmt.Printf("Failed to load timezone: %s\n", err)
		return
	}

	now := time.Now().In(loc)
	zone, _ := now.Zone()

	geo_db, err := geoip2.Open("/app/GeoLite2-City.mmdb")
	if err != nil {
		fmt.Printf("Failed to open GeoIP2 database: %s\n", err)
		return
	}
	defer geo_db.Close()

	fmt.Printf("[%s %s] Loaded GeoIP2 database\n", time.Now().In(loc).Format("2006-01-02 15:04:05"), zone)

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
	http.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		// Get the real IP address of the client from the X-Real-IP header
		realIP := r.Header.Get("X-Real-IP")

		// If the X-Real-IP header is not set, use the remote address
		if realIP == "" {
			realIP = r.RemoteAddr
		} else {
			// Spawn a goroutine to resolve the IP address to a city
			go func(ip string, db *Database) {
				parsedIP := net.ParseIP(ip)
				if parsedIP == nil {
					fmt.Printf("Failed to parse IP address: %s\n", ip)
					return
				}

				record, err := geo_db.City(parsedIP)
				if err != nil {
					fmt.Printf("Failed to get city for IP address %s: %s\n", ip, err)
					return
				}

				city := record.City.Names["en"]
				country := record.Country.Names["en"]

				if city == "" {
					city = "Unknown City"
				}
				if country == "" {
					country = "Unknown Country"
				}

				fmt.Printf("[%s %s] Resolved IP %s to %s, %s\n", time.Now().In(loc).Format("2006-01-02 15:04:05"), zone, ip, city, country)

				// Update the database with the resolved city and country
				err = db.UpdateUserLocation(ip, *record)
				if err != nil {
					fmt.Printf("Failed to update user location for IP %s: %s\n", ip, err)
					return
				}
			}(realIP, db)
		}

		// Log the request
		fmt.Printf("[%s %s] Received request: %s %s %s\n",
			time.Now().In(loc).Format("2006-01-02 15:04:05"), zone, realIP, r.Method, r.URL)

		// Set the header to text/html
		// w.Header().Set("Content-Type", "text/html; charset=utf-8")
		// w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")

		// // Return the contents of /html/index.html
		// http.ServeFile(w, r, "/html/index.html")

		http.Error(w, "Not Found", http.StatusNotFound)
	})

	// Handler for the /data path
	http.HandleFunc("GET /football/bet/data/{$}", func(w http.ResponseWriter, r *http.Request) {
		// Create a new BetResponse
		betResponse, err := NewBetResponse(db)
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
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")

		// Write the JSON response
		w.Write(jsonData)
	})

	// Handler for the /locations path
	http.HandleFunc("GET /locations/{$}", func(w http.ResponseWriter, r *http.Request) {
		// Get the user locations from the database
		locations, err := db.GetUserLocations()
		if err != nil {
			http.Error(w, "Failed to get user locations", http.StatusInternalServerError)
			return
		}

		locationData := LocationData{
			SingleIP:  false,
			Locations: locations,
		}

		// Create a function map for the template
		funcMap := template.FuncMap{
			"formatTime": func(t time.Time) string {
				return t.In(loc).Format("Mon 2 Jan 2006 15:04:05 MST")
			},
		}

		// Set the header to text/html
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		
		// Create a new template with the function map
		locationTemplate, err := template.New("location_template.html").Funcs(funcMap).ParseFiles("/html/location_template.html")
		if err != nil {
			fmt.Printf("Failed to parse template: %s\n", err)
			http.Error(w, "Failed to parse template", http.StatusInternalServerError)
			return

		}

		// Execute the template with the locations data
		err = locationTemplate.Execute(w, locationData)
		if err != nil {
			fmt.Printf("Failed to execute template: %s\n", err)
			http.Error(w, "Failed to execute template", http.StatusInternalServerError)
			return
		}
	})

	getIpAddressHandler := func(w http.ResponseWriter, r *http.Request) {
		ip := r.PathValue("ip")

		// Validate the IP address
		parsedIP := net.ParseIP(ip)
		if parsedIP == nil {
			http.Error(w, "Invalid IP address", http.StatusBadRequest)
			return
		}

		// Get the user locations from the database
		locations, err := db.GetUserLocationByIP(parsedIP.String())
		if err != nil {
			http.Error(w, "Failed to get user locations", http.StatusInternalServerError)
			return
		}
		
		locationData := LocationData{
			SingleIP:  true,
			Locations: locations,
		}
		
		// Create a function map for the template
		funcMap := template.FuncMap{
			"formatTime": func(t time.Time) string {
				return t.In(loc).Format("Mon 2 Jan 2006 15:04:05 MST")
			},
		}

		// Set the header to text/html
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		
		// Create a new template with the function map
		locationTemplate, err := template.New("location_template.html").Funcs(funcMap).ParseFiles("/html/location_template.html")
		if err != nil {
			fmt.Printf("Failed to parse template: %s\n", err)
			http.Error(w, "Failed to parse template", http.StatusInternalServerError)
			return

		}

		// Execute the template with the locations data
		err = locationTemplate.Execute(w, locationData)
		if err != nil {
			fmt.Printf("Failed to execute template: %s\n", err)
			http.Error(w, "Failed to execute template", http.StatusInternalServerError)
			return
		}
	}

	http.HandleFunc("GET /locations/{ip}", getIpAddressHandler)
	http.HandleFunc("GET /locations/{ip}/", getIpAddressHandler)

	http.ListenAndServe(":8080", nil)
}
