use super::*;

#[test]
fn test_split_table_name() {
    assert_eq!(split_table_name("dbo", "users"), ("dbo", "users"));
    assert_eq!(split_table_name("dbo", "Sales.Orders"), ("Sales", "Orders"));
    assert_eq!(split_table_name("public", "my_table"), ("public", "my_table"));
    assert_eq!(split_table_name("public", "schema2.table2"), ("schema2", "table2"));
}
