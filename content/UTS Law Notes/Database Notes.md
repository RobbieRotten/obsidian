#tag-notes #tag-tutorial

Alexander Harb - 24715841

### SQL Joins Cheat Sheet

INNER JOINS
An inner join between two tables will return only records where a joining field, such as a key, finds a match in both tables.
INNER JOIN join ON one field
SELECT *
FROM ARTIST AS ART
INNER JOIN ALBUM AS ALB
ON ART.ARTIST_ID = ALB.ARTIST_ID;
-POWERED BY DATALAB
INNER JOIN with USING
SELECT *
FROM ARTIST AS ART
INNER JOIN ALBUM AS ALB
USING (ARTIST_ID);

POWERED BY DATALAB
SELF JOIN
Self-joins are used to compare values in a table to other values of the same table by joining different parts of a table together.
SELECT
  alb1.artist_id,
  alb1.title AS alb1_title,
  alb2.title AS alb2_title
FROM album as alb1
INNER JOIN album as alb2
ON art1.artist_id = art2.artist_id;
POWERED BY DATALAB
LEFT JOIN
A left join keeps all of the original records in the left table and returns missing values for any columns from the right table where the joining field did not find a match.
LEFT JOIN on one field
SELECT *
FROM ARTIST AS ART
LEFT JOIN ALBUM AS ALB
ON ART.ARTIST_ID = ALB.ARTIST_ID;

POWERED BY DATALAB
RIGHT JOIN
A right join keeps all of the original records in the right table and returns missing values for any columns from the left table where the joining field did not find a match. Right joins are far less common than left joins, because right joins can always be re-written as left joins.
RIGHT JOIN on one field
SELECT *
FROM ARTIST AS ART
RIGHT JOIN ALBUM AS ALB
ON ART.ARTIST_ID = ALB.ARTIST_ID;
POWERED BY DATALAB
FULL JOIN
A full join combines a left join and right join. A full join will return all records from a table, irrespective of whether there is a match on the joining field in the other table, returning null values accordingly.
FULL JOIN on one field
SELECT *
FROM ARTIST AS ART
FULL OUTER JOIN ALBUM AS ALB
ON ART.ARTIST_ID = ALB.ARTIST_ID;
POWERED BY DATALAB
CROSS JOIN
CROSS JOIN creates all possible combinations of two tables. CROSS JOIN does not require a field to join ON.
SELECT NAME, TITLE
FROM ARTIST
CROSS JOIN ALBUM;
-- Drop the tables below

DROP TABLE IF EXISTS Users;
DROP TABLE IF EXISTS Chat_Member;
DROP TABLE IF EXISTS Chat;

--=================================================================================================
-- Create and insert into the tables below

-- Creating Users Table
CREATE TABLE Users
    (       Phone_Number varchar(10) NOT NULL,
            First_Name varchar(10),
            Last_Name varchar(10),
            Profile_Picture varchar(100),
            Status_Message varchar(80),
            Passkey varchar(15),
            Email_Address varchar(40),
            Account_Creation_Date DATE,
            Last_Seen_Timestamp TIMESTAMP,
CONSTRAINT Users_PK PRIMARY KEY (Phone_Number)
);

-- Entering Users Data
INSERT INTO Users VALUES ('0415320922','Mary','Jane','https://shorturl.at/UV567','Hey Im feeling pretty good!','GCp8XfKfqVDFjxC','MaryJane@gmail.com','2021-06-05','2023-10-11 15:45:32');
INSERT INTO Users VALUES ('0458923166','James','Macdonald','https://shorturl.at/rwDP2','Feeling blue :(','ACnwGYzkFn4tP6n','JamieBoy@outlook.com','2022-11-09','2024-01-05 19:32:18');
INSERT INTO Users VALUES ('0492310845','Leah','Strind','https://shorturl.at/otxR0','Im starting to hit my stride','eP9qV2V9mn2z7gy','ItsMeLeah@gmail.com','2024-02-19','2024-05-02 07:52:10');
INSERT INTO Users VALUES ('0423910185','Mack','Blane','https://shorturl.at/gpKO0','Lifes yours for the taking!','T4J5NTUh7XGznZN','MacksStacks@hotmail.com','2020-03-15','2022-09-11 02:35:46');
INSERT INTO Users VALUES ('0437864522','Alex','Jones','https://shorturl.at/cCLVZ','Wake up sheeple!','XBJeZV5KbKPC7AQ','AlexJones@gmail.com','2020-09-11','2023-05-02 13:11:22');
INSERT INTO Users VALUES ('0498322776','Ben','Marshall','https://shorturl.at/bwGK8','Lifes a game','stzcABMSZ5sENpa','BenM@outlook.com','2021-08-14','2024-03-12 16:32:59');
INSERT INTO Users VALUES ('0498322676','Noah','William','https://shorturl.at/CDFQ1','Wowwww that crazy','XBdeZVdkjbnbKP','NoahNoah@gmail.com','2021-07-05','2023-05-02 18:06:29');

-- Creating Chat Table
CREATE TABLE Chat 
    (       Chat_ID numeric(10) NOT NULL,
            Creation_timestamp TIMESTAMP,
            Message_History varchar(1000),
            Member_list varchar(100),
            Chat_Size numeric(10),
CONSTRAINT Chat_PK PRIMARY KEY (Chat_ID)
);

-- Entering Chat Data
INSERT INTO Chat VALUES (1, '2023-10-11 15:45:32','"Hey! Hows it going?" "Not bad, just chilling. You?" "Same, just catching up on some reading. Anything exciting happening?','Noah, Mack', 2);
INSERT INTO Chat VALUES (2, '2023-05-01 08:00:00', 'Hey there! Whats new? Not much, just enjoying the day. You? Just finished a great workout! Feeling pumped!', 'Mary, James', 2);
INSERT INTO Chat VALUES (3, '2023-05-01 09:15:00', 'Welcome to our new chatroom! Everyone, please introduce yourselves and share something interesting about you.', 'James, Alex, Mack', 3);
INSERT INTO Chat VALUES (4, '2023-05-02 10:30:00', 'Discussing the upcoming event details. Please check the schedule and confirm your availability.', 'Leah, Ben', 2);
INSERT INTO Chat VALUES (5, '2023-05-02 11:45:00', 'Sharing some cool resources on Python programming. Check out the links and let us know if you have questions.', 'James, Ben, Jack', 3);
INSERT INTO Chat VALUES (6, '2023-05-03 12:00:00', 'Planning the project timeline. We need to finalize the milestones by end of this week.', 'Mack, Mary, Ben', 3);
INSERT INTO Chat VALUES (7, '2023-04-09 6:40:00', 'Can you believe it is almost Christmas? I cannot wait for the holidays.', 'Leah, Noah', 2);

-- Creating Chat_Member Table
CREATE TABLE Chat_Member 
    (       Phone_Number varchar(10) NOT NULL,
            Chat_ID numeric(10) NOT NULL,
CONSTRAINT Chat_Member_PK PRIMARY KEY (Phone_Number, Chat_ID),
CONSTRAINT Chat_Member_FK1 FOREIGN KEY (Phone_Number) REFERENCES Users(Phone_Number),
CONSTRAINT Chat_Member_FK2 FOREIGN KEY (Chat_ID) REFERENCES Chat(Chat_ID)
);


-- Entering Chat_Member Data
INSERT INTO Chat_Member VALUES ('0498322676', 1);  -- Noah
INSERT INTO Chat_Member VALUES ('0423910185', 1);  -- Mack
INSERT INTO Chat_Member VALUES ('0437864522', 1);  -- Alex

INSERT INTO Chat_Member VALUES ('0415320922', 2);  -- Mary
INSERT INTO Chat_Member VALUES ('0458923166', 2);  -- James

INSERT INTO Chat_Member VALUES ('0458923166', 3);  -- James
INSERT INTO Chat_Member VALUES ('0437864522', 3);  -- Alex
INSERT INTO Chat_Member VALUES ('0423910185', 3);  -- Mack

INSERT INTO Chat_Member VALUES ('0492310845', 4);  -- Leah
INSERT INTO Chat_Member VALUES ('0498322776', 4);  -- Ben

INSERT INTO Chat_Member VALUES ('0458923166', 5);  -- James
INSERT INTO Chat_Member VALUES ('0498322776', 5);  -- Ben

INSERT INTO Chat_Member VALUES ('0423910185', 6);  -- Mack
INSERT INTO Chat_Member VALUES ('0415320922', 6);  -- Mary
INSERT INTO Chat_Member VALUES ('0498322776', 6);  -- Ben

INSERT INTO Chat_Member VALUES ('0498322676', 7);  -- Noah
INSERT INTO Chat_Member VALUES ('0492310845', 7);  -- Leah

--=================================================================================================
-- Select * from TableName Statements
-- Note: Please write the “select * from TableName” statements in one line.

-- 2.b.1: Question: Get all the information of all users stored in the database.
-- 2.b.1: SELECT statement: 
SELECT * FROM Users;

-- 2.b.2: Question: Get all the information of all chats stored in the database.
-- 2.b.2: SELECT statement:

SELECT * FROM Chat;

-- 2.b.3: Question: Get all the information of all the chat-user asssignments stored in the database.
-- 2.b.3: SELECT statement:

SELECT * FROM Chat_Member;

--=================================================================================================
-- 3.a: Question: How many Chats is Noah in ?
-- 3.a: SELECT statement uinsg Group by:

SELECT COUNT(Phone_Number) FROM Chat_Member
WHERE Phone_Number = '0498322676'
GROUP BY Phone_Number;

-- 3.b: Question: Find the Chat ID from Chats older than 2023-05-03 12:00:00
-- 3.b: SELECT statement uisng Inner Join:

SELECT DISTINCT Ch.Chat_ID FROM Chat AS Ch
INNER JOIN Chat_Member AS Memb ON Ch.Chat_ID = Memb.Chat_ID WHERE Ch.Creation_timestamp < '2023-05-03 12:00:00'
ORDER BY Chat_ID;

-- 3.c: Question: Find the names of the users in Chat 2
-- 3.c: SELECT statement using Sub Query:

SELECT First_Name, Last_Name FROM Users WHERE Phone_Number IN (SELECT Phone_Number FROM Chat_Member WHERE Chat_ID = '2');

# Practice Exam 1 Questions 

## L3-6

Give the average price of pizzas from each country of origin, do not list countries with only one pizza.


select m.country, avg(price)
from menu m
where m.country in (
    select country
    from menu
    group by country
    having count(*) > 1
)
group by m.country

## L4-9

List all ingredients and their types for the 'margarita' pizza. Do not use a subquery.










select r.ingredient, i.type
from recipe r, items i
where r.Pizza = 'margarita'
AND r.Ingredient = i.ingredient;
## L7-21

List each ingredient and the pizza that contains the largest amount of this ingredient.



select ingredient, pizza, amount
from recipe r1
where r1.amount = (
    select MAX(r2.amount)
    from recipe r2
    where r2.ingredient = r1.ingredient
);

# Practice Exam 2 Questions 

## L3-7

Give the average price of pizzas from each country of origin, only list countries with 'i' in the country's name.
Sort your results based on country in ascending order.






select country, AVG(Price)
from menu
where country like '%i%'
group by country
order by country;


## L5-13

List all ingredients for the Mexican pizza (i.e. country = 'mexico'). You must use a subquery.

-- Type query below
select distinct ingredient
from recipe 
where pizza in 
        (select pizza
        from menu
        where country = 'mexico');

# 

# Practice Exam 3 Questions 

## 

## L4-11

List all 'meat' ingredients used in pizzas, also list the pizza names. Do not use a subquery.












select i.ingredient, r.pizza 
from recipe r inner join items i
on r.ingredient = i.ingredient
where i.type = 'meat'
;
## L6-20

List all pizzas that cost less than 'siciliano' pizza, also give their prices.

-- Type query below
select pizza, price 
from menu 
where price < (select price 
               from menu
               where pizza = 'siciliano');
## L7-23

List the ingredients, and for each ingredient, also list the pizza that contains the largest amount of this ingredient.








select ingredient, pizza, amount
from recipe r1
where r1.amount =(
    select MAX(r2.amount)
    from recipe r2
    where r2.ingredient = r1.ingredient
)




# SQL Assessment 3


## Q1

## Question 1 (1 mark)

- Show all materials that cost more than 100 and less than 300 from the supplier (per unit).
- Show the materialId (rename to materialCode) and materialName.
- Sort the results based on material ID.
  - SELECT r.MaterialID AS materialCode, r.MaterialName
  - FROM RawMaterial_t r INNER JOIN Supplies_t s 
  - ON r.MaterialID = s.MaterialID WHERE (s.SupplyUnitPrice > 100 
  -                                       AND s.SupplyUnitPrice < 300)
  - ORDER BY r.MaterialID
  - ;
## Q2

### Question 2 (1 mark)

- Find the employees who have more than one skill.
- Show employeeName and skillDescription.
- Sort the results based on employeeName, then by skillDescription.
- You need to append '_t' to the end of your tablenames (e.g. customer_t)
- SELECT DISTINCT e.employeeName, s.skillDescription
- FROM EmployeeSkills_t es
- JOIN Employee_t e ON es.EmployeeID = e.EmployeeID
- JOIN Skill_t s ON es.SkillID = s.SkillID
- WHERE es.employeeID IN (SELECT es2.EmployeeID
    -                     FROM EmployeeSkills_t es2
    -                     GROUP BY es2.EmployeeID
    -                     HAVING COUNT(es2.SkillID) > 1)
- ORDER BY e.EmployeeName, s.SkillDescription;
## Q3

### Question 3 (1 mark)

- Find the employees who have more than one skill.
- Show employeeName, skillDescription, and the number of skills that this employee has.
- Sort the results based on employeeName, then by skillDescription.
- You need to append '_t' to the end of your tablenames (e.g. customer_t)
  - SELECT e.EmployeeName, s.SkillDescription, (SELECT COUNT(es2.SkillID) FROM EmployeeSkills_t es2 WHERE es2.EmployeeID = e.EmployeeID)  AS count
  - FROM Employee_t e
  - JOIN EmployeeSkills_t es  ON e.EmployeeID = es.EmployeeID
  - JOIN Skill_t s ON es.SkillID = s.SkillID
- WHERE es.EmployeeID IN (SELECT EmployeeID
  - FROM EmployeeSkills_t
  - GROUP BY EmployeeID
  - HAVING COUNT(SkillID) > 1)
- ORDER BY e.EmployeeName, s.SkillDescription;
## Q4

- For each material, find the cheapest vender (i.e. a vendor with the lowest supplyUnitPrice for this material).
- Show material name, vender name and supply Unit Price .
- Sort your results based on the material name.
- You need to append '_t' to the end of your tablenames (e.g. customer_t)

SELECT m.MaterialName, (SELECT VendorName FROM Vendor_t v WHERE v.VendorID = s.VendorID) AS VendorName, s.SupplyUnitPrice
FROM RawMaterial_t m, Supplies_t s
WHERE m.MaterialID = s.MaterialID 
AND s.SupplyUnitPrice = (
        SELECT MIN(s2.SupplyUnitPrice)
        FROM Supplies_t s2
        WHERE s2.MaterialID = s.MaterialID
    )
ORDER BY m.MaterialName;
# Cheat Sheet

- Basic Commands and Clauses
  - SELECT: Retrieve data from a database table.
    - SELECT column1, column2 FROM table_name;
  - FROM: Specify the table to retrieve data from.
    - SELECT column1, column2 FROM table_name;
  - WHERE: Filter records based on specified conditions.
    - SELECT column1, column2 FROM table_name WHERE condition;
  - AS: Rename a column or table with an alias.
    - SELECT column1 AS alias_name FROM table_name;
  - JOIN: Combine rows from two or more tables based on a related column.
    - SELECT columns FROM table1 JOIN table2 ON table1.column = table2.column;
  - AND: Combine multiple conditions in a WHERE clause, all conditions must be true.
    - SELECT column1, column2 FROM table_name WHERE condition1 AND condition2;
  - OR: Combine multiple conditions in a WHERE clause, at least one condition must be true.
    - SELECT column1, column2 FROM table_name WHERE condition1 OR condition2;
  - LIMIT: Limit the number of rows returned.
    - SELECT column1, column2 FROM table_name LIMIT number;
  - IN: Specify multiple possible values for a column.
    - SELECT column1, column2 FROM table_name WHERE column IN (value1, value2);
  - CASE: Conditional results.
    - SELECT column1, CASE WHEN condition THEN 'Result' ELSE 'Default' END FROM table_name;
  - IS NULL: Check for NULL.
    - SELECT column1 FROM table_name WHERE column IS NULL;
  - LIKE: Pattern matching.(strings using wildcards.)
    - SELECT column1 FROM table_name WHERE productdescription Like ‘%Table’; - substring def
    - the % wildcard in ‘%Table’  indicates that all strings that have any number of characters preceding the word “Table” will be allowed
    - '%i' for ending in i
    - 'i%' for beginning in i
  - ORDER BY: Sort results.
    - SELECT column1, column2 FROM table_name ORDER BY column1 ASC/DESC;
  - GROUP BY: Group rows.
    - SELECT COUNT(*), column1 FROM table_name GROUP BY column1;
  - HAVING: Filter groups. Indicate the conditions under which a category (group) will be included
    - SELECT COUNT(*), column1 FROM table_name GROUP BY column1 HAVING COUNT(*) > 1;
    - HAVING operates on groups (categories), not on individual rows. EX: column 1
- Aggregate Functions
  - AVG: Calculate the average value of a numeric column.
    - SELECT AVG(column_name) FROM table_name;
  - SUM: Calculate the total sum of a numeric column.
    - SELECT SUM(column_name) FROM table_name;
  - MIN: Find the minimum value in a column.
    - SELECT MIN(column_name) FROM table_name;
  - MAX: Find the maximum value in a column.
    - SELECT MAX(column_name) FROM table_name;
  - COUNT - the number of rows in a table/group/result table of a select statement.
    - SELECT COUNT(column_name) FROM table_name;
  - ALL
    - Iff comparison is true for all values in the list provided by the subquery.
    - EX: Checks against highest quantity from list
- Scalar and Vector Aggregates
  - Scalar Aggregate: Single value returned from an aggregate function.
    - SELECT AVG(productstandardprice) FROM product_t;
  - Vector Aggregate: Multiple values returned from an aggregate function using GROUP BY.
    - SELECT CustomerState, COUNT(CustomerState) FROM Customer GROUP BY CustomerState;
- Data Definition Language (DDL)
  - Identifier (Key) – an attribute (or combination of attributes) that uniquely identifies individual instances of an entity type 
  - ➢ Simple versus Composite Identifier 
  - ➢ Candidate Identifier– an attribute (or combination of attributes) that could be a key… satisfies the requirements for being an identifier
  - Entities
    - an Entity would be STUDENT, 
    - an Entity Instance would be one particular student, such as yourself,
    - an Entity Type will be the template of storing data related to the STUDENT and will have more details like the STUDENT attributes (properties or characteristics). 
    - This is STUDENT Type (Entity type):
    - 
  - Derived attributes 
    - – The value of a derived attribute can be calculated from related attribute values.                
    - – Derived attributes are not physically stored in the database.
    - Birthday -> age (derived attribute)
  - Multivalued attributes 
    - – may take more than one value for a given entity (or relationship) instance
    - an employee can have more than one skill (Multivalued attribute)
    - 
    - 
  - SQL Data Types
    - String
    - Number
      - int
    - Temporal
      - timestamp
    - Boolean
    - 
  - Table Actions
  - Relationship types
    - Unary Relationship 
      - A relationship between instances of the same entity Also called a recursive relationship
    - Binary Relationship 
      - A relationship between instances of two entities
    - Ternary Relationship 
      - A relationship among instances of three entities
  - Cardinality Constraints
    - Minimum Cardinality
      - If zero then optional
      - If one or more, then mandatory
    - Maximum Cardinality
      - The maximum number
  - Strong vs Weak .
    - Strong entity 
      - exists independently of other types of entities has its own unique identifier - identifier underlined with single line
    - Weak entity
      - dependent on a strong entity (identifying owner) and cannot exist on its own. 
      - does not have a unique identifier (only has a partial identifier 
        - entity box has double lines (book
        - partial identifier underlined with double lines (book
      - Has a composite key of its partial identifier and the PK of the strong entity.
    - Double Line: Between Weak and Strong entities
    - 
  - Supertype Constraints
    - Disjoint Rule: An instance of the supertype can be a member of only ONE of the subtypes.
    - Overlap Rule: An instance of the supertype could be a member of more than one of the subtypes.
    - 
  - Delete types
    - Restrict: don’t allow delete of  “parent” side if related rows exist in “dependent” side
    - Cascade: automatically delete “dependent” side rows that correspond with the “parent” side row to be deleted.
    - Set-to-Null: set the foreign key in the dependent side to null if deleting from the parent side.
      - Set-to-Null is not allowed for weak and associated entities (where FK are part of the key).
      - 🡪Set-to-Null is not allowed when is related to a mandatory cardinality.
  - Candidate keys
- Categorizing Results Using GROUP BY Clause
  - Scalar aggregate: single value returned from SQL query with aggregate function
    - select avg(productstandardprice) from product_t;
  - Vector aggregate: multiple values returned from SQL query with aggregate function (via GROUP BY)
    - Note: You can use single-value fields with aggregate functions if they are included in the GROUP BY clause
    - SELECT CustomerState, COUNT (CustomerState)
    - FROM Customer T
    - GROUP BY CustomerState;

- Types of Joins
  - INNER JOIN: Like an intersection of two sets. Returns records with matching values in both tables.
    - SELECT r.MaterialID AS materialCode, r.MaterialName
      - FROM RawMaterial_t r
      - INNER JOIN Supplies_t s ON r.MaterialID = s.MaterialID
      - WHERE s.SupplyUnitPrice > 100 AND s.SupplyUnitPrice < 300
      - ORDER BY r.MaterialID;
    - Analogy: Imagine two circles overlapping (like a Venn diagram). The inner join is the overlapping part where both circles meet.
  - LEFT JOIN: Like taking all elements from the left set and matching them with the right set, including non-matching elements as NULL from the right.
    - SELECT t1.column1, t2.column2
      - FROM table1 t1
      - LEFT JOIN table2 t2 ON t1.common_column = t2.common_column;
    - Analogy: Think of it as taking all employees (left table) and their department names (right table). If an employee does not belong to any department, you still list the employee but show NULL for the department
  - RIGHT JOIN: Like taking all elements from the right set and matching them with the left set, including non-matching elements as NULL from the left.
    - SELECT t1.column1, t2.column2
      - FROM table1 t1
      - RIGHT JOIN table2 t2 ON t1.common_column = t2.common_column;
    - Analogy: Imagine a classroom (right table) and a list of students (left table). If there are students not in the classroom, you still list all classrooms and show NULL for students not in the classroom.
  - FULL JOIN: Combines results of both left and right joins. Returns all records when there is a match in either left or right table, with NULLs where there are no matches
    - SELECT t1.column1, t2.column2
      - FROM table1 t1
      - FULL JOIN table2 t2 ON t1.common_column = t2.common_column;
    - Analogy: Think of it as merging two contact lists. You include all contacts from both lists, even if they don't appear in both, filling in missing information with NULLs.
  - CROSS JOIN: Returns the Cartesian product of two tables. Every row from the first table is matched with every row from the second table.
    - SELECT t1.column1, t2.column2
      - FROM table1 t1
      - CROSS JOIN table2 t2;
    - Analogy: Imagine making every possible combination of ice cream flavors (left table) and toppings (right table). Every flavor is paired with every topping.
  - Self Join: Joins a table with itself.
    - Give all pizzas that originate from the same country as the 'siciliano' pizza, excluding 'siciliano': - THIS SYNTAX SAYS WHERE FIND P1.PIZZA FROM P1.COUNTRY = P2.COUNTRY WHEN P2.PIZZA NAME IS SICILIANO
      - SELECT p1.pizzaName, p1.price
      - FROM Menu p1
      - JOIN Menu p2 ON p1.country = p2.country
      - WHERE p2.pizzaName = 'siciliano' AND p1.pizzaName != 'siciliano';
    - Analogy: Think of employees in an organization where you want to pair each employee with their manager
  - JOIN WITHOUT SUBQUERY
    - List all 'fish' ingredients used in pizzas.
      - SELECT i.ingredient, r.pizza
      - FROM Recipe r
      - JOIN items i ON r.ingredient = i.ingredient
      - WHERE i.type = 'fish';
  - Join with subquery
    - SELECT ingredient, pizza
    - FROM Recipe 
    - WHERE ingredient IN (
    -     SELECT ingredient
    -     FROM items
    -     WHERE type = 'fish'
    - );
- Subqueries
  - Subquery in WHERE clause:
    - SELECT DISTINCT e.employeeName, s.skillDescription
    - FROM EmployeeSkills_t es
    - JOIN Employee_t e ON es.EmployeeID = e.EmployeeID
    - JOIN Skill_t s ON es.SkillID = s.SkillID
    - WHERE es.EmployeeID IN (
    -     SELECT es2.EmployeeID
    -     FROM EmployeeSkills_t es2
    -     GROUP BY es2.EmployeeID
    -     HAVING COUNT(es2.SkillID) > 1
    - )
    - ORDER BY e.EmployeeName, s.SkillDescription;
  - Subquery in SELECT clause:
    - SELECT e.EmployeeName, s.SkillDescription, (
    -     SELECT COUNT(es2.SkillID)
    -     FROM EmployeeSkills_t es2
    -     WHERE es2.EmployeeID = e.EmployeeID
    - ) AS count
    - FROM Employee_t e
    - JOIN EmployeeSkills_t es ON e.EmployeeID = es.EmployeeID
    - JOIN Skill_t s ON es.SkillID = s.SkillID
    - WHERE es.EmployeeID IN (
    -     SELECT EmployeeID
    -     FROM EmployeeSkills_t
    -     GROUP BY EmployeeID
    -     HAVING COUNT(SkillID) > 1
    - )
    - ORDER BY e.EmployeeName, s.SkillDescription;
  - Subquery in FROM clause:
    - SELECT m.MaterialName, (
    -     SELECT VendorName
    -     FROM Vendor_t v
    -     WHERE v.VendorID = s.VendorID
    - ) AS VendorName, s.SupplyUnitPrice
    - FROM RawMaterial_t m, Supplies_t s
    - WHERE m.MaterialID = s.MaterialID
    - AND s.SupplyUnitPrice = (
    -     SELECT MIN(s2.SupplyUnitPrice)
    -     FROM Supplies_t s2
    -     WHERE s2.MaterialID = s.MaterialID
    - )
    - ORDER BY m.MaterialName;
  - List pizzas with at least one 'meat' ingredient - looking for pizza name from menu table and ingredient type meat from ingredient table 
    - SELECT DISTINCT p.pizzaName
    - FROM Menu p
    - WHERE EXISTS (
    -     SELECT *
    -     FROM Recipe r
    -     JOIN Items i ON r.ingredient = i.ingredient
    -     WHERE r.pizza = p.pizza AND i.type = 'meat'
- Correlated Subqueries
  - Correlated Subquery: Uses values from the outer query.
    - SELECT column1
    - FROM table1 AS t1
    - WHERE EXISTS (SELECT * 
    -               FROM table2 AS t2
    -               WHERE t2.column2 = t1.column1 AND t2.condition)
  - Example - prices greater than the average price of their respective categories.
    - SELECT p.product_name, p.price, c.category_name
    - FROM products p
    - JOIN categories c ON p.category_id = c.category_id
    - WHERE p.price > (
    -     SELECT AVG(p2.price)
    -     FROM products p2
    -     WHERE p2.category_id = p.category_id
    - );
    - Explanation
      - For each row in the products table, the subquery computes the average price of all products that have the same category_id as the current row's category_id.
        - Calculates avg of everything with the same category EX: cat 1
        - Then does next category EX: Cat 2
      - The main query then checks if the current row's price is greater than this average price.
        - Checks if p.price(insert number) is < or > AVG Cat 1 value
        - AFTER first part - Checks if p.price(insert number) is < or > AVG Cat 2 calculation 
      - If the condition is true, the product is included in the result set.
      - p.price = current price
- Filtered Aggregate Function
  - Give the cheapest price of pizzas from each country of origin, only list countries with the cheapest price of less than $7.00:
    - SELECT country, MIN(price) AS min_price
    - FROM Menu
    - GROUP BY country
    - HAVING MIN(price) < 7.00;
- Give the average price of pizzas from each country of origin and rename the column:
  - SELECT country, AVG(price) AS average
  - FROM Menu
  - GROUP BY country;
- 

