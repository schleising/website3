# RSS Feed Reader

## Requirements

### General

1. All reads and writes to the database shall be performed through the FastAPI API, and not directly from the frontend
2. All data sent to or read from the database shall be validated and sanitized to prevent security vulnerabilities
3. All data sent to or read from the database shall be implemented as Pydantic models to ensure data integrity and consistency
4. All data sent to or read from the client shall be validated and sanitized to prevent security vulnerabilities
5. All data sent to or read from the client shall be implemented as Pydantic models to ensure data integrity and consistency
6. The feed reader shall be implemented as a page on the main site and retain the look and feel of the rest of the site, including the left and right menus
7. The feed reader shall be usable on both desktop and mobile devices, with a responsive design that adapts to different screen sizes
8. All client reads shall use the Fetch API to call the FastAPI endpoints, with appropriate error handling and user feedback for failed requests
9. All client writes shall use the Fetch API to call the FastAPI endpoints, with appropriate error handling and user feedback for failed requests

### UI and Functionality Reqs

10. The feed reader links shall appear between Football and OpenSky Database in the left menu and the home page
11. The feed reader shall only be available to logged in users
12. The feed reader shall be available at the URL path `/feeds/`
13. The feed reader shall display unread articles in full width cards on the feed reader page, with the oldest articles appearing at the top of the list
14. The feed reader shall auto refresh every 10 seconds to check for new feeds
15. The feed reader shall allow the user to move through feeds using j (next) and k (previous) keys, and open the selected feed in a new tab using the spacebar or enter key
16. The feed reader shall allow the user to add new RSS feeds by entering a URL and clicking an "Add" button, all feeds should be added to a category
17. The user added feeds shall be stored in the database for each user and persist across sessions
18. A user shall only be able to view and modify their own feeds, not the feeds of other users
19. The right menu shall display a list of feed categories and an unread article count for each category
20. clicking on a category shall filter the feed reader to only show articles from that category
21. The right menu shall have an all feeds category that shows all articles regardless of category with an unread article count for all feeds
22. The right menu shall have a Recently Read category that shows all articles that have been marked as read in the last 7 days, sorted by most recently read first 
23. It shall be possible to "mute" and "unmute" categories
24. Articles from a muted category shall not appear in the feed reader, whichever category is currrently selected, but the unread article count for that category shall still be displayed in the right menu
25. Muting and unmuting categories shall be implemented as a user preference stored in the database, and shall persist across sessions
26. The feed reader shall have a settings page where users can manage their feed preferences, including muting and unmuting categories

### Backend Reqs

23. Backend code shall be implemented in the backend/src/feeds directory, with appropriate subdirectories for database models, API endpoints, and background tasks
24. The backend code shall be implemented as a new thread that runs alongside the existing backend code, and shall not interfere with the existing functionality of the site
25. The backend code shall be responsible for creating a mongodb feeds database and the necessary collections and indexes to store feed data, user subscriptions, and read/unread status of articles
26. The backend code shall fetch subscribed feeds once every 5 minutes and store the feed data in the database
27. The backend shall only fetch each subscription once, even if multiple users are subscribed to the same feed, to avoid unnecessary network requests and reduce load on the feed servers
28. The feeds shall be fetched and stored in the database in a way that allows for efficient querying and filtering by category, read/unread status, and other relevant criteria
29. The backend shall mark articles as deleted after 7 days
30. The backend shall permanently delete articles that have been marked as deleted for more than 30 days

### FastAPI Reqs

31. FastAPI code shall be implemented in the website/feeds directory, with appropriate subdirectories for API endpoints and database models
32. The FastAPI code shall mark articles as read when the user clicks on them in the feed reader UI, and this information shall be stored in the database
33. The FastAPI code shall provide an API endpoint to retrieve the list of feeds and their associated articles for the logged in user, with support for filtering by category and read/unread status
34. The FastAPI code shall provide an API endpoint to add new feed subscriptions for the logged in user, which shall validate the feed URL and return an appropriate response if the URL is invalid or the feed cannot be fetched
35. The FastAPI code shall provide an API endpoint to mark articles as read for the logged in user, which shall update the database accordingly and return an appropriate response if the article ID is invalid or the user is not authorized to modify the article's read status
36. The FastAPI code shall provide an API endpoint to retrieve the list of feed categories and their associated unread article counts for the logged in user, which shall return an appropriate response if the user is not authorized to access the feed data

## Design

