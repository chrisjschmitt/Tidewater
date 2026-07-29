## Goal
Build a prototype for a personal web app (PWA) called Tidewater
## Mission
The app will be designed to help users gently learn that financially speaking, they have what they need to live their best life

## Brief
Tidewater is an helps the user to create a personal financial budget. It encourages an abundance mindset, shifting the task of budgeting away from scarcity and restriction to one that encourages you to use all of the resources you have available to live your best life. 

To accomplish that the app helps the user to:
- focus on what they have rather than what they want (appreciation rather than excess); 
- without being “preachy”, aligns your spending toward a balanced and healthy lifestyle; 
- without judging, helps the user to set aside funds for big things that are important in their life, like saving for retirement, or taking a vacation, or buying a home

## UX Design
- The app will first operate as a dashboard that fits a standard desktop or table screen in landscape mode. A smartphone version would be a future enhancement.
- It should be very easy to use, for example, using sliders, toggles, drag and drop, or any other styling tricks to keep things simple
- The design should reflect a balanced (almost meditative), abundance mindset and never feel pushy or judgemental
- The app will allow the user to import a budget from a csv file. Create a default csv file for a hypothetical user named Ted that is a 30 year old single male living in Calgary, Alberta who rents an apartment and has a mid-level management job
- The dashboard will display: 
	- a simple to understand summary of monthly income vs expenses, perhaps a progress circle 
	- a horizontal bar display representing each expense group, from highest spend to lowest. 
	- What ever expenses don’t fit into the window need to be summarized as “everything else” and can be expanded if needed
	- Clicking or tapping on each expense group will open a window displaying the expense subgroups
	- The user will be able to increase or reduce the amount of budget set for each subgroup
	- For any funds left (income vs expenses), a view that displays the growth over time of a set portion of those savings towards a goal, for example, an RRSP, Home ownership savings plan, a vacation, a new car, or a user defined goal. Alternatively, the user could use the funds to pay off a debt. Allow the user to adjust the interest rate, but assume a high-interest savings account
- There will be a chat button that allows the user to ask questions about their budget, or provide recommendations to balance their budget, provide a few examples questions
- When a someone uses the app for the first time, the app should request a minimum amount of information from the user to build a budget, or to offer advice via the chat. 
- Given the above rule, I recognize that some information will be needed to display a complete dashboard, for example, whether the user rents or owns their home, whether they have any debt, whether single, married or common law spouse 
- Personal data is ALWAYS kept on the users device and can be exported if the user wants to transfer the data to another device. Never store personal information in the cloud.
- use only open source helpers/apps to build the application

## Acceptance Criteria
The code for the first prototype will be completed when:
- The app runs on my local browser
- I can successfully load the default spreadsheet for Ted (which you will create)
- I have a working dashboard where I can change the values the expense subgroups and see those changes reflected in the budget summary
- I can create one or more savings goal(s) where I can see how my money will grow over time to reach that goal
- I can import 12 months of transactions exported from Monarch Money and the app derives an average monthly income and spend (the test file “Transactions_2026-07-29.csv” _is in the project directory called Test-Data
- I can create a new, realistic budget from scratch with a minimal number of questions.

Ask me if there are any questions that I need to answer before you can build the app.
